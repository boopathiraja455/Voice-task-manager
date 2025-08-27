import { NextRequest, NextResponse } from 'next/server'
import { TaskManager } from '@/lib/json-storage'

const taskManager = new TaskManager()

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')
    const priority = searchParams.get('priority') as 'low' | 'medium' | 'high' | null
    const completed = searchParams.get('completed')
    const search = searchParams.get('search')
    const limit = searchParams.get('limit')
    const offset = searchParams.get('offset')

    // Build filters object
    const filters: any = {}
    if (category) filters.category = category
    if (priority) filters.priority = priority
    if (completed !== null) filters.completed = completed === 'true'

    const options: any = {}
    if (limit) options.limit = parseInt(limit)
    if (offset) options.offset = parseInt(offset)

    let tasks = await taskManager.getTasks(filters, options)

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase()
      tasks = tasks.filter(task => 
        task.description.toLowerCase().includes(searchLower) ||
        task.category.toLowerCase().includes(searchLower)
      )
    }

    return NextResponse.json(tasks)
  } catch (error) {
    console.error('Error fetching tasks:', error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    
    // Validate required fields
    if (!data.description?.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    // Create task with defaults
    const taskData = {
      description: data.description.trim(),
      dueDate: data.dueDate || new Date().toISOString(),
      category: data.category || 'todo',
      priority: data.priority || 'medium',
      completed: false,
      frequency: data.frequency || null,
      createdDate: new Date().toISOString(),
      completionHistory: null,
      reminderOffset: data.reminderOffset || null,
      nextDueDate: data.nextDueDate || null
    }

    const newTask = await taskManager.createTask(taskData)
    return NextResponse.json(newTask, { status: 201 })
  } catch (error) {
    console.error('Error creating task:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const data = await request.json()
    
    if (!data.id) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 })
    }

    const updatedTask = await taskManager.updateTask(data.id, data)
    
    if (!updatedTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json(updatedTask)
  } catch (error) {
    console.error('Error updating task:', error)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 })
    }

    const deleted = await taskManager.deleteTask(parseInt(id))
    
    if (!deleted) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting task:', error)
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}