import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tasks } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;

    // Validate ID is valid integer
    if (!id || isNaN(parseInt(id))) {
      return NextResponse.json({
        error: "Valid task ID is required",
        code: "INVALID_ID"
      }, { status: 400 });
    }

    // Fetch existing task from database
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

    const task = existingTask[0];
    const currentTimestamp = new Date().toISOString();

    // Parse existing completion history or create new array
    let completionHistory: string[] = [];
    if (task.completionHistory) {
      completionHistory = Array.isArray(task.completionHistory) 
        ? task.completionHistory 
        : [];
    }

    // Add current timestamp to completion history
    completionHistory.push(currentTimestamp);

    // Prepare update object
    let updateData: any = {
      completed: true,
      completionHistory: completionHistory
    };

    // Handle recurrence if task has frequency
    if (task.frequency && task.dueDate) {
      const currentDueDate = new Date(task.dueDate);
      let nextDueDate: Date;

      switch (task.frequency) {
        case 'Daily':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setDate(currentDueDate.getDate() + 1);
          break;
        case 'Weekly Once':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setDate(currentDueDate.getDate() + 7);
          break;
        case 'Monthly Once':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setDate(currentDueDate.getDate() + 30);
          break;
        default:
          nextDueDate = currentDueDate;
      }

      // For recurring tasks, reset completed status and update dates
      updateData = {
        ...updateData,
        completed: false,
        dueDate: nextDueDate.toISOString(),
        nextDueDate: nextDueDate.toISOString()
      };
    }

    // Update the task in database
    const updatedTask = await db.update(tasks)
      .set(updateData)
      .where(eq(tasks.id, parseInt(id)))
      .returning();

    if (updatedTask.length === 0) {
      return NextResponse.json({
        error: 'Failed to update task',
        code: 'UPDATE_FAILED'
      }, { status: 500 });
    }

    return NextResponse.json(updatedTask[0], { status: 200 });

  } catch (error) {
    console.error('POST error:', error);
    return NextResponse.json({
      error: 'Internal server error: ' + error
    }, { status: 500 });
  }
}