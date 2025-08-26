import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  description: text('description').notNull(),
  dueDate: text('due_date').notNull(),
  category: text('category').notNull().default('Personal'),
  priority: text('priority').notNull().default('medium'),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  frequency: text('frequency'),
  createdDate: text('created_date').notNull(),
  completionHistory: text('completion_history', { mode: 'json' }),
  reminderOffset: integer('reminder_offset'),
  nextDueDate: text('next_due_date'),
});