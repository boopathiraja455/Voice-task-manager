import { NextRequest, NextResponse } from 'next/server'
import { TaskManager } from '@/lib/json-storage'

const taskManager = new TaskManager()

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')
    const priority = searchParams.get('priority') as 'low' | 'medium' | 'high' | null
    const completed = searchParams.get('completed')

    // Build filters object
    const filters: any = {}
    if (category) filters.category = category
    if (priority) filters.priority = priority
    if (completed !== null) filters.completed = completed === 'true'

    const tasks = await taskManager.getTasks(filters)
    
    const jsonString = JSON.stringify(tasks, null, 2)
    const buffer = Buffer.from(jsonString, 'utf-8')

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="tasks_export_${new Date().toISOString().split('T')[0]}.json"`,
        'Content-Length': buffer.length.toString()
      }
    })
  } catch (error) {
    console.error('Error exporting tasks:', error)
    return NextResponse.json({ error: 'Failed to export tasks' }, { status: 500 })
  }
}