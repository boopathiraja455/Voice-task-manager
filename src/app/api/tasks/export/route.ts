import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { tasks } from '@/db/schema';

export async function GET(request: NextRequest) {
  try {
    // Fetch all tasks from database without pagination for export
    const allTasks = await db.select().from(tasks);

    // Generate export timestamp
    const exportTimestamp = new Date().toISOString();

    // Create export data with metadata
    const exportData = {
      exportedAt: exportTimestamp,
      totalTasks: allTasks.length,
      tasks: allTasks
    };

    // Create response with proper headers for JSON download
    const response = NextResponse.json(exportData, { status: 200 });

    // Set headers for file download
    response.headers.set('Content-Type', 'application/json');
    response.headers.set('Content-Disposition', 'attachment; filename=tasks-export.json');
    response.headers.set('Cache-Control', 'no-cache');

    return response;

  } catch (error) {
    console.error('GET tasks export error:', error);
    return NextResponse.json({ 
      error: 'Internal server error: Failed to export tasks',
      code: 'EXPORT_FAILED'
    }, { status: 500 });
  }
}