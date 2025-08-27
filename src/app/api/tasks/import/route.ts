import { NextRequest, NextResponse } from 'next/server'
import { TaskManager } from '@/lib/json-storage'

const taskManager = new TaskManager()

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.type !== 'application/json') {
      return NextResponse.json({ error: 'Invalid file type. Please upload a JSON file.' }, { status: 400 })
    }

    const text = await file.text()
    let importData

    try {
      importData = JSON.parse(text)
    } catch (parseError) {
      return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 })
    }

    if (!Array.isArray(importData)) {
      return NextResponse.json({ error: 'JSON must contain an array of tasks' }, { status: 400 })
    }

    const result = await taskManager.importTasks(importData)
    
    return NextResponse.json({
      success_count: result.successCount,
      skipped_count: result.skippedCount,
      invalid_count: result.invalidCount,
      total: importData.length
    })
  } catch (error) {
    console.error('Error importing tasks:', error)
    return NextResponse.json({ error: 'Failed to import tasks' }, { status: 500 })
  }
}