import { db } from '@/db';
import { tasks } from '@/db/schema';

async function main() {
    const now = new Date();
    const currentTimestamp = now.toISOString();
    
    const sampleTasks = [
        {
            description: 'Update daily expenses in spreadsheet',
            dueDate: new Date(now.getTime() + 1 * 60 * 1000).toISOString(),
            category: 'Work',
            priority: 'medium',
            completed: false,
            frequency: 'Daily',
            createdDate: currentTimestamp,
            completionHistory: null,
            reminderOffset: null,
            nextDueDate: null,
        },
        {
            description: 'Take evening vitamins',
            dueDate: new Date(now.getTime() + 1.5 * 60 * 1000).toISOString(),
            category: 'Health',
            priority: 'high',
            completed: false,
            frequency: 'Weekly Once',
            createdDate: currentTimestamp,
            completionHistory: null,
            reminderOffset: null,
            nextDueDate: null,
        },
        {
            description: 'Review tomorrow\'s meeting agenda',
            dueDate: new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
            category: 'Work',
            priority: 'medium',
            completed: false,
            frequency: null,
            createdDate: currentTimestamp,
            completionHistory: null,
            reminderOffset: null,
            nextDueDate: null,
        },
        {
            description: 'Call mom to check in',
            dueDate: new Date(now.getTime() + 2.5 * 60 * 1000).toISOString(),
            category: 'Personal',
            priority: 'low',
            completed: false,
            frequency: null,
            createdDate: currentTimestamp,
            completionHistory: null,
            reminderOffset: null,
            nextDueDate: null,
        },
        {
            description: 'Backup computer files',
            dueDate: new Date(now.getTime() + 3 * 60 * 1000).toISOString(),
            category: 'Other',
            priority: 'high',
            completed: false,
            frequency: 'Monthly Once',
            createdDate: currentTimestamp,
            completionHistory: null,
            reminderOffset: null,
            nextDueDate: null,
        }
    ];

    await db.insert(tasks).values(sampleTasks);
    
    console.log('✅ Tasks seeder completed successfully');
}

main().catch((error) => {
    console.error('❌ Seeder failed:', error);
});