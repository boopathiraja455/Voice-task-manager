import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tasks } from '@/db/schema';

interface TaskImportData {
  description: string;
  dueDate: string;
  category?: string;
  priority?: string;
  completed?: boolean;
  frequency?: string;
  createdDate?: string;
  completionHistory?: any;
  reminderOffset?: number;
  nextDueDate?: string;
}

interface ImportRequest {
  tasks: TaskImportData[];
}

interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: string[];
}

function isValidISOString(dateString: string): boolean {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime()) && dateString === date.toISOString();
}

function validateTask(task: any, index: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!task.description || typeof task.description !== 'string' || task.description.trim() === '') {
    errors.push(`Task ${index + 1}: description is required and must be a non-empty string`);
  }

  if (!task.dueDate || typeof task.dueDate !== 'string') {
    errors.push(`Task ${index + 1}: dueDate is required and must be a string`);
  } else if (!isValidISOString(task.dueDate)) {
    errors.push(`Task ${index + 1}: dueDate must be a valid ISO string`);
  }

  if (task.category && typeof task.category !== 'string') {
    errors.push(`Task ${index + 1}: category must be a string`);
  }

  if (task.priority && typeof task.priority !== 'string') {
    errors.push(`Task ${index + 1}: priority must be a string`);
  }

  if (task.completed !== undefined && typeof task.completed !== 'boolean') {
    errors.push(`Task ${index + 1}: completed must be a boolean`);
  }

  if (task.frequency && typeof task.frequency !== 'string') {
    errors.push(`Task ${index + 1}: frequency must be a string`);
  }

  if (task.createdDate && typeof task.createdDate !== 'string') {
    errors.push(`Task ${index + 1}: createdDate must be a string`);
  } else if (task.createdDate && !isValidISOString(task.createdDate)) {
    errors.push(`Task ${index + 1}: createdDate must be a valid ISO string`);
  }

  if (task.reminderOffset !== undefined && (typeof task.reminderOffset !== 'number' || !Number.isInteger(task.reminderOffset))) {
    errors.push(`Task ${index + 1}: reminderOffset must be an integer`);
  }

  if (task.nextDueDate && typeof task.nextDueDate !== 'string') {
    errors.push(`Task ${index + 1}: nextDueDate must be a string`);
  } else if (task.nextDueDate && !isValidISOString(task.nextDueDate)) {
    errors.push(`Task ${index + 1}: nextDueDate must be a valid ISO string`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export async function POST(request: NextRequest) {
  try {
    let requestBody: ImportRequest;

    try {
      requestBody = await request.json();
    } catch (error) {
      return NextResponse.json({
        error: 'Invalid JSON in request body',
        code: 'INVALID_JSON'
      }, { status: 400 });
    }

    if (!requestBody.tasks || !Array.isArray(requestBody.tasks)) {
      return NextResponse.json({
        error: 'Request body must contain a tasks array',
        code: 'MISSING_TASKS_ARRAY'
      }, { status: 400 });
    }

    if (requestBody.tasks.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        failed: 0,
        errors: []
      }, { status: 200 });
    }

    const result: ImportResult = {
      success: false,
      imported: 0,
      failed: 0,
      errors: []
    };

    const currentTimestamp = new Date().toISOString();

    for (let i = 0; i < requestBody.tasks.length; i++) {
      const task = requestBody.tasks[i];
      const validation = validateTask(task, i);

      if (!validation.valid) {
        result.failed++;
        result.errors.push(...validation.errors);
        continue;
      }

      try {
        const taskData = {
          description: task.description.trim(),
          dueDate: task.dueDate,
          category: task.category?.trim() || 'Personal',
          priority: task.priority?.trim() || 'medium',
          completed: task.completed ?? false,
          frequency: task.frequency?.trim() || null,
          createdDate: task.createdDate || currentTimestamp,
          completionHistory: task.completionHistory || null,
          reminderOffset: task.reminderOffset ?? null,
          nextDueDate: task.nextDueDate || null
        };

        await db.insert(tasks).values(taskData);
        result.imported++;
      } catch (error) {
        result.failed++;
        result.errors.push(`Task ${i + 1}: Database error - ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    result.success = result.imported > 0;

    const status = result.failed === 0 ? 201 : 200;
    return NextResponse.json(result, { status });

  } catch (error) {
    console.error('POST error:', error);
    return NextResponse.json({
      error: 'Internal server error: ' + error
    }, { status: 500 });
  }
}