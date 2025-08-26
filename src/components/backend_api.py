"""
FastAPI backend module for secure JSON file management, task persistence, and recurrence calculation.
Provides REST endpoints for task management, import/export, and announcement summaries.
"""

import asyncio
import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Union, Any
import threading
import time

from dateutil.relativedelta import relativedelta
from fastapi import FastAPI, HTTPException, Query, File, UploadFile, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, validator
import uvicorn


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('task_backend.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global configuration
DATA_DIR = Path("public/data")
TASKS_FILE = DATA_DIR / "tasks.json"
CACHE_EXPIRATION = 10  # seconds
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB

# Ensure data directory exists
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Thread-safe file lock and cache
file_lock = threading.Lock()
task_cache = {"data": None, "expires_at": 0}


class Frequency(BaseModel):
    """Task recurrence frequency configuration."""
    type: str = Field(..., regex="^(daily|weekly|monthly|yearly)$")
    interval: int = Field(default=1, ge=1, le=365)
    days_of_week: Optional[List[int]] = Field(default=None, description="0=Monday, 6=Sunday")
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)


class Reminder(BaseModel):
    """Task reminder configuration."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    time_before: int = Field(..., ge=0, description="Minutes before due date")
    message: Optional[str] = None
    sent: bool = Field(default=False)


class Task(BaseModel):
    """Core task model with validation and type safety."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str = Field(..., min_length=1, max_length=500)
    category: str = Field(default="general", max_length=50)
    due_date: datetime
    completed: bool = Field(default=False)
    completed_at: Optional[datetime] = None
    frequency: Optional[Frequency] = None
    next_due_date: Optional[datetime] = None
    reminders: List[Reminder] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @validator('description')
    def sanitize_description(cls, v):
        """Sanitize description field to remove control characters and scripts."""
        if not v:
            raise ValueError('Description cannot be empty')
        # Remove control characters and potential script tags
        sanitized = ''.join(char for char in v if ord(char) >= 32 or char in '\n\t')
        sanitized = sanitized.replace('<script', '&lt;script').replace('</script>', '&lt;/script&gt;')
        return sanitized.strip()

    @validator('category')
    def sanitize_category(cls, v):
        """Sanitize category field."""
        sanitized = ''.join(char for char in v if char.isalnum() or char in '_-. ')
        return sanitized.strip() or "general"

    @validator('due_date', 'next_due_date', 'completed_at', pre=True)
    def parse_datetime(cls, v):
        """Parse ISO 8601 datetime strings and ensure timezone awareness."""
        if v is None:
            return v
        if isinstance(v, str):
            try:
                dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except ValueError:
                raise ValueError(f'Invalid datetime format: {v}')
        return v

    def update_timestamp(self):
        """Update the updated_at timestamp."""
        self.updated_at = datetime.now(timezone.utc)


class TaskCreate(BaseModel):
    """Model for creating new tasks."""
    description: str = Field(..., min_length=1, max_length=500)
    category: str = Field(default="general", max_length=50)
    due_date: datetime
    frequency: Optional[Frequency] = None
    reminders: List[Reminder] = Field(default_factory=list)


class TaskUpdate(BaseModel):
    """Model for updating existing tasks."""
    description: Optional[str] = Field(None, min_length=1, max_length=500)
    category: Optional[str] = Field(None, max_length=50)
    due_date: Optional[datetime] = None
    frequency: Optional[Frequency] = None
    reminders: Optional[List[Reminder]] = None


class CompleteTaskRequest(BaseModel):
    """Model for task completion request."""
    auto_reschedule: bool = Field(default=True)


class ImportSummary(BaseModel):
    """Summary of import operation."""
    success_count: int
    skipped_count: int
    invalid_count: int
    errors: List[str]


class AnnouncementSummary(BaseModel):
    """Summary data for morning and evening announcements."""
    today_uncompleted: List[Task]
    tomorrow_tasks: List[Task]
    today_overdue: List[Task]
    announcement_text: Dict[str, str]  # "morning" and "evening" keys


def calculate_next_due_date(current_due: datetime, frequency: Frequency) -> datetime:
    """
    Calculate the next due date based on frequency configuration.
    Uses dateutil.relativedelta for precise date arithmetic.
    """
    if frequency.type == "daily":
        return current_due + timedelta(days=frequency.interval)
    
    elif frequency.type == "weekly":
        if frequency.days_of_week:
            # Find next occurrence of specified weekdays
            current_weekday = current_due.weekday()
            target_days = sorted(frequency.days_of_week)
            
            # Find next target day
            next_day = None
            for day in target_days:
                if day > current_weekday:
                    next_day = day
                    break
            
            if next_day is None:
                # Next occurrence is next week
                next_day = target_days[0]
                days_ahead = (7 - current_weekday) + next_day
            else:
                days_ahead = next_day - current_weekday
            
            return current_due + timedelta(days=days_ahead)
        else:
            return current_due + timedelta(weeks=frequency.interval)
    
    elif frequency.type == "monthly":
        next_date = current_due + relativedelta(months=frequency.interval)
        
        if frequency.day_of_month:
            # Try to set specific day of month, fall back to last day if overflow
            try:
                next_date = next_date.replace(day=frequency.day_of_month)
            except ValueError:
                # Day doesn't exist in target month (e.g., Feb 31), use last day
                next_month = next_date + relativedelta(months=1)
                last_day = (next_month.replace(day=1) - timedelta(days=1)).day
                next_date = next_date.replace(day=last_day)
        
        return next_date
    
    elif frequency.type == "yearly":
        return current_due + relativedelta(years=frequency.interval)
    
    else:
        raise ValueError(f"Unsupported frequency type: {frequency.type}")


async def load_tasks() -> List[Task]:
    """Load tasks from JSON file with caching and validation."""
    current_time = time.time()
    
    # Check cache first
    if task_cache["data"] and current_time < task_cache["expires_at"]:
        return task_cache["data"]
    
    with file_lock:
        try:
            if TASKS_FILE.exists():
                with open(TASKS_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                tasks = []
                for item in data:
                    try:
                        task = Task(**item)
                        tasks.append(task)
                    except Exception as e:
                        logger.warning(f"Skipping invalid task {item.get('id', 'unknown')}: {e}")
                
                # Update cache
                task_cache["data"] = tasks
                task_cache["expires_at"] = current_time + CACHE_EXPIRATION
                
                return tasks
            else:
                return []
                
        except Exception as e:
            logger.error(f"Error loading tasks: {e}")
            return []


async def save_tasks(tasks: List[Task]) -> bool:
    """Save tasks to JSON file with atomic writes and validation."""
    with file_lock:
        try:
            # Prepare data for serialization
            data = []
            for task in tasks:
                task_dict = task.dict()
                # Convert datetime objects to ISO strings
                for field in ['due_date', 'completed_at', 'next_due_date', 'created_at', 'updated_at']:
                    if task_dict.get(field):
                        task_dict[field] = task_dict[field].isoformat()
                data.append(task_dict)
            
            # Atomic write: write to temp file, then rename
            with tempfile.NamedTemporaryFile(
                mode='w', 
                suffix='.json', 
                dir=DATA_DIR, 
                delete=False,
                encoding='utf-8'
            ) as temp_file:
                json.dump(data, temp_file, indent=2, ensure_ascii=False)
                temp_file.flush()
                os.fsync(temp_file.fileno())
                temp_path = temp_file.name
            
            # Atomic rename
            os.rename(temp_path, TASKS_FILE)
            
            # Invalidate cache
            task_cache["data"] = None
            task_cache["expires_at"] = 0
            
            logger.info(f"Successfully saved {len(tasks)} tasks")
            return True
            
        except Exception as e:
            logger.error(f"Error saving tasks: {e}")
            # Clean up temp file if it exists
            try:
                if 'temp_path' in locals():
                    os.unlink(temp_path)
            except:
                pass
            return False


def filter_tasks(
    tasks: List[Task],
    due_date: Optional[str] = None,
    status: Optional[str] = None,
    category: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0
) -> List[Task]:
    """Filter tasks based on query parameters."""
    filtered = tasks.copy()
    now = datetime.now(timezone.utc)
    today = now.date()
    tomorrow = today + timedelta(days=1)
    
    # Filter by due date
    if due_date == "today":
        filtered = [t for t in filtered if t.due_date.date() == today]
    elif due_date == "tomorrow":
        filtered = [t for t in filtered if t.due_date.date() == tomorrow]
    
    # Filter by status
    if status == "due":
        filtered = [t for t in filtered if not t.completed and t.due_date.date() <= today]
    elif status == "overdue":
        filtered = [t for t in filtered if not t.completed and t.due_date < now]
    elif status == "completed":
        filtered = [t for t in filtered if t.completed]
    
    # Filter by category
    if category:
        filtered = [t for t in filtered if t.category.lower() == category.lower()]
    
    # Apply pagination
    if offset:
        filtered = filtered[offset:]
    if limit:
        filtered = filtered[:limit]
    
    return filtered


def generate_announcement_text(summary: AnnouncementSummary) -> Dict[str, str]:
    """Generate human-readable announcement text for morning and evening."""
    morning_parts = []
    evening_parts = []
    
    # Morning announcement
    if summary.today_overdue:
        count = len(summary.today_overdue)
        morning_parts.append(f"You have {count} overdue task{'s' if count > 1 else ''}.")
    
    if summary.today_uncompleted:
        count = len(summary.today_uncompleted)
        morning_parts.append(f"You have {count} task{'s' if count > 1 else ''} due today.")
        
        # Add first few task descriptions
        for i, task in enumerate(summary.today_uncompleted[:3]):
            morning_parts.append(f"Task {i+1}: {task.description}")
        
        if len(summary.today_uncompleted) > 3:
            remaining = len(summary.today_uncompleted) - 3
            morning_parts.append(f"And {remaining} more task{'s' if remaining > 1 else ''}.")
    
    if not summary.today_uncompleted and not summary.today_overdue:
        morning_parts.append("You have no tasks due today. Great job!")
    
    # Evening announcement
    if summary.tomorrow_tasks:
        count = len(summary.tomorrow_tasks)
        evening_parts.append(f"You have {count} task{'s' if count > 1 else ''} due tomorrow.")
        
        # Add task descriptions
        for i, task in enumerate(summary.tomorrow_tasks[:3]):
            evening_parts.append(f"Task {i+1}: {task.description}")
        
        if len(summary.tomorrow_tasks) > 3:
            remaining = len(summary.tomorrow_tasks) - 3
            evening_parts.append(f"And {remaining} more task{'s' if remaining > 1 else ''}.")
    else:
        evening_parts.append("You have no tasks due tomorrow. Enjoy your evening!")
    
    return {
        "morning": " ".join(morning_parts),
        "evening": " ".join(evening_parts)
    }


# FastAPI application setup
app = FastAPI(
    title="Task Management API",
    description="Secure JSON file-based task management with recurrence calculation",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


@app.get("/api/tasks", response_model=List[Task])
async def get_tasks(
    due_date: Optional[str] = Query(None, regex="^(today|tomorrow)$"),
    status: Optional[str] = Query(None, regex="^(due|overdue|completed)$"),
    category: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: int = Query(0, ge=0)
):
    """Get filtered list of tasks with pagination support."""
    try:
        tasks = await load_tasks()
        filtered_tasks = filter_tasks(tasks, due_date, status, category, limit, offset)
        
        logger.info(f"Retrieved {len(filtered_tasks)} tasks (filters: due_date={due_date}, status={status}, category={category})")
        return filtered_tasks
        
    except Exception as e:
        logger.error(f"Error retrieving tasks: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/tasks", response_model=Task)
async def create_task(task_data: TaskCreate):
    """Create a new task with schema validation and initial due date calculation."""
    try:
        tasks = await load_tasks()
        
        # Create new task
        new_task = Task(
            description=task_data.description,
            category=task_data.category,
            due_date=task_data.due_date,
            frequency=task_data.frequency,
            reminders=task_data.reminders
        )
        
        # Calculate initial next_due_date if frequency is set
        if new_task.frequency:
            new_task.next_due_date = calculate_next_due_date(new_task.due_date, new_task.frequency)
        
        tasks.append(new_task)
        
        if await save_tasks(tasks):
            logger.info(f"Created new task: {new_task.id}")
            return new_task
        else:
            raise HTTPException(status_code=500, detail="Failed to save task")
            
    except Exception as e:
        logger.error(f"Error creating task: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, task_update: TaskUpdate):
    """Update an existing task with validation."""
    try:
        tasks = await load_tasks()
        
        # Find task
        task_index = None
        for i, task in enumerate(tasks):
            if task.id == task_id:
                task_index = i
                break
        
        if task_index is None:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Update fields
        task = tasks[task_index]
        
        if task_update.description is not None:
            task.description = task_update.description
        if task_update.category is not None:
            task.category = task_update.category
        if task_update.due_date is not None:
            task.due_date = task_update.due_date
        if task_update.frequency is not None:
            task.frequency = task_update.frequency
            # Recalculate next due date if frequency changed
            if task.frequency:
                task.next_due_date = calculate_next_due_date(task.due_date, task.frequency)
            else:
                task.next_due_date = None
        if task_update.reminders is not None:
            task.reminders = task_update.reminders
        
        task.update_timestamp()
        
        if await save_tasks(tasks):
            logger.info(f"Updated task: {task_id}")
            return task
        else:
            raise HTTPException(status_code=500, detail="Failed to save task")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating task {task_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/tasks/{task_id}/complete", response_model=Task)
async def complete_task(task_id: str, request: CompleteTaskRequest = CompleteTaskRequest()):
    """Mark task as completed and optionally reschedule based on frequency."""
    try:
        tasks = await load_tasks()
        
        # Find task
        task_index = None
        for i, task in enumerate(tasks):
            if task.id == task_id:
                task_index = i
                break
        
        if task_index is None:
            raise HTTPException(status_code=404, detail="Task not found")
        
        task = tasks[task_index]
        
        # Mark as completed
        task.completed = True
        task.completed_at = datetime.now(timezone.utc)
        task.update_timestamp()
        
        # Handle rescheduling
        if request.auto_reschedule and task.frequency:
            # Calculate next occurrence
            next_due = calculate_next_due_date(task.due_date, task.frequency)
            
            # Create new task for next occurrence
            new_task = Task(
                description=task.description,
                category=task.category,
                due_date=next_due,
                frequency=task.frequency,
                reminders=[Reminder(
                    time_before=r.time_before,
                    message=r.message
                ) for r in task.reminders]  # Copy reminders but reset sent status
            )
            
            # Calculate next_due_date for the new task
            new_task.next_due_date = calculate_next_due_date(new_task.due_date, new_task.frequency)
            
            tasks.append(new_task)
            logger.info(f"Created recurring task: {new_task.id} for {next_due}")
        
        if await save_tasks(tasks):
            logger.info(f"Completed task: {task_id} (auto_reschedule={request.auto_reschedule})")
            return task
        else:
            raise HTTPException(status_code=500, detail="Failed to save task")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing task {task_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/tasks/import", response_model=ImportSummary)
async def import_tasks(file: UploadFile = File(...)):
    """Import tasks from JSON file with validation and deduplication."""
    try:
        # Validate file size
        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="File too large")
        
        # Parse JSON
        try:
            import_data = json.loads(content.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
        
        if not isinstance(import_data, list):
            raise HTTPException(status_code=400, detail="JSON must be an array of tasks")
        
        # Load existing tasks
        existing_tasks = await load_tasks()
        existing_ids = {task.id for task in existing_tasks}
        
        # Process imported tasks
        success_count = 0
        skipped_count = 0
        invalid_count = 0
        errors = []
        
        for i, item in enumerate(import_data):
            try:
                # Create task object for validation
                if isinstance(item, dict) and 'id' in item:
                    # Check for duplicate IDs
                    if item['id'] in existing_ids:
                        skipped_count += 1
                        continue
                
                task = Task(**item)
                
                # Calculate next_due_date if frequency is set
                if task.frequency and not task.next_due_date:
                    task.next_due_date = calculate_next_due_date(task.due_date, task.frequency)
                
                existing_tasks.append(task)
                existing_ids.add(task.id)
                success_count += 1
                
            except Exception as e:
                invalid_count += 1
                errors.append(f"Item {i+1}: {str(e)}")
        
        # Save updated tasks
        if success_count > 0:
            if not await save_tasks(existing_tasks):
                raise HTTPException(status_code=500, detail="Failed to save imported tasks")
        
        summary = ImportSummary(
            success_count=success_count,
            skipped_count=skipped_count,
            invalid_count=invalid_count,
            errors=errors[:10]  # Limit error list
        )
        
        logger.info(f"Import completed: {success_count} success, {skipped_count} skipped, {invalid_count} invalid")
        return summary
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during import: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/tasks/export")
async def export_tasks():
    """Export all tasks as JSON stream."""
    try:
        tasks = await load_tasks()
        
        # Convert to serializable format
        export_data = []
        for task in tasks:
            task_dict = task.dict()
            # Convert datetime objects to ISO strings
            for field in ['due_date', 'completed_at', 'next_due_date', 'created_at', 'updated_at']:
                if task_dict.get(field):
                    task_dict[field] = task_dict[field].isoformat()
            export_data.append(task_dict)
        
        # Create JSON string
        json_content = json.dumps(export_data, indent=2, ensure_ascii=False)
        
        # Return as streaming response
        def generate():
            yield json_content
        
        filename = f"tasks_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        return StreamingResponse(
            generate(),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        logger.error(f"Error during export: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/announcements/summary", response_model=AnnouncementSummary)
async def get_announcement_summary():
    """Get computed summaries for morning and evening announcements."""
    try:
        tasks = await load_tasks()
        now = datetime.now(timezone.utc)
        today = now.date()
        tomorrow = today + timedelta(days=1)
        
        # Filter tasks for announcements
        today_uncompleted = [
            t for t in tasks 
            if not t.completed and t.due_date.date() == today
        ]
        
        tomorrow_tasks = [
            t for t in tasks 
            if not t.completed and t.due_date.date() == tomorrow
        ]
        
        today_overdue = [
            t for t in tasks 
            if not t.completed and t.due_date < now and t.due_date.date() < today
        ]
        
        # Sort by due date
        today_uncompleted.sort(key=lambda x: x.due_date)
        tomorrow_tasks.sort(key=lambda x: x.due_date)
        today_overdue.sort(key=lambda x: x.due_date)
        
        summary = AnnouncementSummary(
            today_uncompleted=today_uncompleted,
            tomorrow_tasks=tomorrow_tasks,
            today_overdue=today_overdue,
            announcement_text={}
        )
        
        # Generate announcement text
        summary.announcement_text = generate_announcement_text(summary)
        
        logger.info(f"Generated announcement summary: {len(today_uncompleted)} today, {len(tomorrow_tasks)} tomorrow, {len(today_overdue)} overdue")
        return summary
        
    except Exception as e:
        logger.error(f"Error generating announcement summary: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}


# Command-line utilities
def run_dev_server(host: str = "127.0.0.1", port: int = 8000):
    """Run development server."""
    print(f"Starting development server on http://{host}:{port}")
    print("Data directory:", DATA_DIR.absolute())
    uvicorn.run(app, host=host, port=port, reload=True)


def dry_run_import(file_path: str):
    """Perform a dry-run import validation."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if not isinstance(data, list):
            print("ERROR: JSON must be an array of tasks")
            return
        
        print(f"Validating {len(data)} tasks...")
        
        valid_count = 0
        invalid_count = 0
        
        for i, item in enumerate(data):
            try:
                task = Task(**item)
                valid_count += 1
                print(f"✓ Task {i+1}: {task.description[:50]}...")
            except Exception as e:
                invalid_count += 1
                print(f"✗ Task {i+1}: {e}")
        
        print(f"\nSummary: {valid_count} valid, {invalid_count} invalid")
        
    except Exception as e:
        print(f"ERROR: {e}")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "dev":
            run_dev_server()
        elif sys.argv[1] == "dry-run" and len(sys.argv) > 2:
            dry_run_import(sys.argv[2])
        else:
            print("Usage:")
            print("  python backend_api.py dev                    # Run development server")
            print("  python backend_api.py dry-run <file.json>    # Validate import file")
    else:
        run_dev_server()