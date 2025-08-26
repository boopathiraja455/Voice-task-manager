import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tasks } from '@/db/schema';
import { eq, like, and, or, desc, asc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    // Single task by ID
    if (id) {
      if (!id || isNaN(parseInt(id))) {
        return NextResponse.json({ 
          error: "Valid ID is required",
          code: "INVALID_ID" 
        }, { status: 400 });
      }

      const task = await db.select()
        .from(tasks)
        .where(eq(tasks.id, parseInt(id)))
        .limit(1);

      if (task.length === 0) {
        return NextResponse.json({ 
          error: 'Task not found',
          code: 'TASK_NOT_FOUND' 
        }, { status: 404 });
      }

      return NextResponse.json(task[0]);
    }

    // List tasks with filtering and pagination
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const search = searchParams.get('search');
    const category = searchParams.get('category');
    const priority = searchParams.get('priority');
    const completed = searchParams.get('completed');
    const sort = searchParams.get('sort') || 'createdDate';
    const order = searchParams.get('order') || 'desc';

    let query = db.select().from(tasks);

    // Build where conditions
    const conditions = [];
    
    if (search) {
      conditions.push(like(tasks.description, `%${search}%`));
    }
    
    if (category) {
      conditions.push(eq(tasks.category, category));
    }
    
    if (priority) {
      conditions.push(eq(tasks.priority, priority));
    }
    
    if (completed !== null && completed !== undefined) {
      const isCompleted = completed === 'true';
      conditions.push(eq(tasks.completed, isCompleted));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    // Apply sorting
    const sortField = sort === 'dueDate' ? tasks.dueDate : 
                     sort === 'priority' ? tasks.priority :
                     sort === 'category' ? tasks.category :
                     sort === 'completed' ? tasks.completed :
                     tasks.createdDate;

    if (order === 'asc') {
      query = query.orderBy(asc(sortField));
    } else {
      query = query.orderBy(desc(sortField));
    }

    const results = await query.limit(limit).offset(offset);

    return NextResponse.json(results);

  } catch (error) {
    console.error('GET error:', error);
    return NextResponse.json({ 
      error: 'Internal server error: ' + error 
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.description || body.description.trim() === '') {
      return NextResponse.json({ 
        error: "Description is required",
        code: "MISSING_DESCRIPTION" 
      }, { status: 400 });
    }
    
    if (!body.dueDate) {
      return NextResponse.json({ 
        error: "Due date is required",
        code: "MISSING_DUE_DATE" 
      }, { status: 400 });
    }
    
    // Validate dueDate is a valid ISO datetime
    try {
      new Date(body.dueDate).toISOString();
    } catch {
      return NextResponse.json({ 
        error: "Due date must be a valid ISO datetime string",
        code: "INVALID_DUE_DATE" 
      }, { status: 400 });
    }
    
    // Validate priority if provided
    if (body.priority && !['low', 'medium', 'high'].includes(body.priority)) {
      return NextResponse.json({ 
        error: "Priority must be 'low', 'medium', or 'high'",
        code: "INVALID_PRIORITY" 
      }, { status: 400 });
    }
    
    // Validate nextDueDate if provided
    if (body.nextDueDate) {
      try {
        new Date(body.nextDueDate).toISOString();
      } catch {
        return NextResponse.json({ 
          error: "Next due date must be a valid ISO datetime string",
          code: "INVALID_NEXT_DUE_DATE" 
        }, { status: 400 });
      }
    }
    
    // Validate reminderOffset if provided
    if (body.reminderOffset !== undefined && body.reminderOffset !== null) {
      if (isNaN(parseInt(body.reminderOffset))) {
        return NextResponse.json({ 
          error: "Reminder offset must be a valid integer",
          code: "INVALID_REMINDER_OFFSET" 
        }, { status: 400 });
      }
    }

    // Prepare data for insertion
    const taskData = {
      description: body.description.trim(),
      dueDate: body.dueDate,
      category: body.category || 'Personal',
      priority: body.priority || 'medium',
      completed: body.completed ?? false,
      frequency: body.frequency || null,
      createdDate: new Date().toISOString(),
      completionHistory: body.completionHistory || null,
      reminderOffset: body.reminderOffset ? parseInt(body.reminderOffset) : null,
      nextDueDate: body.nextDueDate || null
    };

    const newTask = await db.insert(tasks)
      .values(taskData)
      .returning();

    return NextResponse.json(newTask[0], { status: 201 });

  } catch (error) {
    console.error('POST error:', error);
    return NextResponse.json({ 
      error: 'Internal server error: ' + error 
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id || isNaN(parseInt(id))) {
      return NextResponse.json({ 
        error: "Valid ID is required",
        code: "INVALID_ID" 
      }, { status: 400 });
    }

    // Check if task exists
    const existingTask = await db.select()
      .from(tasks)
      .where(eq(tasks.id, parseInt(id)))
      .limit(1);

    if (existingTask.length === 0) {
      return NextResponse.json({ 
        error: 'Task not found',
        code: 'TASK_NOT_FOUND' 
      }, { status: 404 });
    }

    const body = await request.json();
    const updates: any = {};

    // Validate and prepare updates
    if (body.description !== undefined) {
      if (!body.description || body.description.trim() === '') {
        return NextResponse.json({ 
          error: "Description cannot be empty",
          code: "INVALID_DESCRIPTION" 
        }, { status: 400 });
      }
      updates.description = body.description.trim();
    }

    if (body.dueDate !== undefined) {
      if (!body.dueDate) {
        return NextResponse.json({ 
          error: "Due date cannot be empty",
          code: "INVALID_DUE_DATE" 
        }, { status: 400 });
      }
      try {
        new Date(body.dueDate).toISOString();
        updates.dueDate = body.dueDate;
      } catch {
        return NextResponse.json({ 
          error: "Due date must be a valid ISO datetime string",
          code: "INVALID_DUE_DATE" 
        }, { status: 400 });
      }
    }

    if (body.category !== undefined) {
      updates.category = body.category || 'Personal';
    }

    if (body.priority !== undefined) {
      if (body.priority && !['low', 'medium', 'high'].includes(body.priority)) {
        return NextResponse.json({ 
          error: "Priority must be 'low', 'medium', or 'high'",
          code: "INVALID_PRIORITY" 
        }, { status: 400 });
      }
      updates.priority = body.priority || 'medium';
    }

    if (body.completed !== undefined) {
      updates.completed = Boolean(body.completed);
    }

    if (body.frequency !== undefined) {
      updates.frequency = body.frequency;
    }

    if (body.completionHistory !== undefined) {
      updates.completionHistory = body.completionHistory;
    }

    if (body.reminderOffset !== undefined) {
      if (body.reminderOffset !== null && isNaN(parseInt(body.reminderOffset))) {
        return NextResponse.json({ 
          error: "Reminder offset must be a valid integer",
          code: "INVALID_REMINDER_OFFSET" 
        }, { status: 400 });
      }
      updates.reminderOffset = body.reminderOffset ? parseInt(body.reminderOffset) : null;
    }

    if (body.nextDueDate !== undefined) {
      if (body.nextDueDate) {
        try {
          new Date(body.nextDueDate).toISOString();
          updates.nextDueDate = body.nextDueDate;
        } catch {
          return NextResponse.json({ 
            error: "Next due date must be a valid ISO datetime string",
            code: "INVALID_NEXT_DUE_DATE" 
          }, { status: 400 });
        }
      } else {
        updates.nextDueDate = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ 
        error: "No valid fields to update",
        code: "NO_UPDATES" 
      }, { status: 400 });
    }

    const updatedTask = await db.update(tasks)
      .set(updates)
      .where(eq(tasks.id, parseInt(id)))
      .returning();

    return NextResponse.json(updatedTask[0]);

  } catch (error) {
    console.error('PUT error:', error);
    return NextResponse.json({ 
      error: 'Internal server error: ' + error 
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id || isNaN(parseInt(id))) {
      return NextResponse.json({ 
        error: "Valid ID is required",
        code: "INVALID_ID" 
      }, { status: 400 });
    }

    // Check if task exists
    const existingTask = await db.select()
      .from(tasks)
      .where(eq(tasks.id, parseInt(id)))
      .limit(1);

    if (existingTask.length === 0) {
      return NextResponse.json({ 
        error: 'Task not found',
        code: 'TASK_NOT_FOUND' 
      }, { status: 404 });
    }

    const deletedTask = await db.delete(tasks)
      .where(eq(tasks.id, parseInt(id)))
      .returning();

    return NextResponse.json({
      message: 'Task deleted successfully',
      task: deletedTask[0]
    });

  } catch (error) {
    console.error('DELETE error:', error);
    return NextResponse.json({ 
      error: 'Internal server error: ' + error 
    }, { status: 500 });
  }
}