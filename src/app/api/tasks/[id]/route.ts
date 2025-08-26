import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tasks } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    
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
        error: 'Task not found' 
      }, { status: 404 });
    }

    return NextResponse.json(task[0]);
  } catch (error) {
    console.error('GET task error:', error);
    return NextResponse.json({ 
      error: 'Internal server error: ' + error 
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    
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
        error: 'Task not found' 
      }, { status: 404 });
    }

    const body = await request.json();

    // Build update object with only provided fields
    const updates: any = {
      updatedAt: new Date().toISOString()
    };

    // Validate and sanitize inputs
    if (body.description !== undefined) {
      if (!body.description?.trim()) {
        return NextResponse.json({ 
          error: "Description is required",
          code: "MISSING_DESCRIPTION" 
        }, { status: 400 });
      }
      updates.description = body.description.trim();
    }

    if (body.dueDate !== undefined) {
      if (!body.dueDate?.trim()) {
        return NextResponse.json({ 
          error: "Due date is required",
          code: "MISSING_DUE_DATE" 
        }, { status: 400 });
      }
      updates.dueDate = body.dueDate.trim();
    }

    if (body.category !== undefined) {
      updates.category = body.category?.trim() || 'Personal';
    }

    if (body.priority !== undefined) {
      updates.priority = body.priority?.trim() || 'medium';
    }

    if (body.completed !== undefined) {
      updates.completed = Boolean(body.completed);
    }

    if (body.frequency !== undefined) {
      updates.frequency = body.frequency?.trim() || null;
    }

    if (body.createdDate !== undefined) {
      updates.createdDate = body.createdDate?.trim() || new Date().toISOString();
    }

    if (body.completionHistory !== undefined) {
      updates.completionHistory = body.completionHistory;
    }

    if (body.reminderOffset !== undefined) {
      updates.reminderOffset = body.reminderOffset ? parseInt(body.reminderOffset) : null;
    }

    if (body.nextDueDate !== undefined) {
      updates.nextDueDate = body.nextDueDate?.trim() || null;
    }

    const updatedTask = await db.update(tasks)
      .set(updates)
      .where(eq(tasks.id, parseInt(id)))
      .returning();

    return NextResponse.json(updatedTask[0]);
  } catch (error) {
    console.error('PUT task error:', error);
    return NextResponse.json({ 
      error: 'Internal server error: ' + error 
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    
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
        error: 'Task not found' 
      }, { status: 404 });
    }

    const deletedTask = await db.delete(tasks)
      .where(eq(tasks.id, parseInt(id)))
      .returning();

    return NextResponse.json({
      message: 'Task deleted successfully',
      deletedTask: deletedTask[0]
    });
  } catch (error) {
    console.error('DELETE task error:', error);
    return NextResponse.json({ 
      error: 'Internal server error: ' + error 
    }, { status: 500 });
  }
}