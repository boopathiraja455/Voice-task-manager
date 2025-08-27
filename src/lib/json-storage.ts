import fs from 'fs/promises'
import path from 'path'

// Environment variable configuration with defaults
const getConfig = () => ({
  tasksDataPath: process.env.TASKS_DATA_PATH || 'public/data/tasks.json',
  settingsPath: process.env.SETTINGS_PATH || 'public/data/settings.json', 
  userPreferencesPath: process.env.USER_PREFERENCES_PATH || 'public/data/user-preferences.json',
  backupDirectory: process.env.BACKUP_DIRECTORY || 'public/data/backups',
  exportDirectory: process.env.EXPORT_DIRECTORY || 'public/data/exports',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseUrlDev: process.env.DATABASE_URL_DEV || 'mongodb://localhost:27017/taskmanager_dev',
  databaseUrlTest: process.env.DATABASE_URL_TEST || 'mongodb://localhost:27017/taskmanager_test',
  databaseUrlProd: process.env.DATABASE_URL_PROD || '',
  backupEnabled: process.env.BACKUP_ENABLED === 'true',
  backupFrequency: process.env.BACKUP_FREQUENCY || 'daily',
  maxBackupFiles: parseInt(process.env.MAX_BACKUP_FILES || '30'),
  cacheEnabled: process.env.CACHE_ENABLED === 'true',
  fileWatchEnabled: process.env.FILE_WATCH_ENABLED === 'true'
})

/**
 * Type definitions for the JSON file management utility
 */
export interface JsonFileOptions {
  /** Base directory for storing JSON files */
  dataDir?: string;
  /** Whether to create backup files before writing */
  createBackups?: boolean;
  /** Whether to use pretty printing for JSON output */
  prettyPrint?: boolean;
  /** Maximum number of backup files to keep */
  maxBackups?: number;
  /** Whether to enable in-memory caching */
  enableCache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtl?: number;
  /** File extension for JSON files */
  fileExtension?: string;
}

export interface Task {
  id: number;
  description: string;
  dueDate: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  frequency?: string;
  createdDate?: string;
  completionHistory?: string[];
  reminderOffset?: number;
  nextDueDate?: string;
}

export interface VoiceSettings {
  selectedVoice: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface AnnouncementSettings {
  enabled: boolean;
  morningTime: string;
  eveningTime: string;
  muted: boolean;
}

export interface SystemSettings {
  masterVolume: number;
  taskDataPath: string;
  backupEnabled: boolean;
}

export interface AppSettings {
  voice: VoiceSettings;
  announcements: AnnouncementSettings;
  system: SystemSettings;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  etag: string;
}

export interface BatchOperation<T> {
  type: 'create' | 'update' | 'delete';
  id?: number | string;
  data?: T;
}

export interface JsonFileStats {
  fileSize: number;
  recordCount: number;
  lastModified: Date;
  backupCount: number;
}

/**
 * Comprehensive JSON file management utility for replacing database operations
 */
export class JsonFileManager {
  private filePath: string
  private backupEnabled: boolean
  private cache: Map<string, any> = new Map()
  private cacheEnabled: boolean

  constructor(filePath: string, options: { backupEnabled?: boolean; cacheEnabled?: boolean } = {}) {
    const config = getConfig()
    this.filePath = filePath
    this.backupEnabled = options.backupEnabled ?? config.backupEnabled
    this.cacheEnabled = options.cacheEnabled ?? config.cacheEnabled
  }

  private getCacheKey(): string {
    return this.filePath
  }

  private async ensureDirectoryExists(): Promise<void> {
    const dir = path.dirname(this.filePath)
    try {
      await fs.access(dir)
    } catch {
      await fs.mkdir(dir, { recursive: true })
    }
  }

  private async createBackup(): Promise<void> {
    if (!this.backupEnabled) return

    try {
      const config = getConfig()
      const backupDir = config.backupDirectory
      await fs.mkdir(backupDir, { recursive: true })

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = path.basename(this.filePath, path.extname(this.filePath))
      const backupPath = path.join(backupDir, `${filename}_${timestamp}.json`)

      const data = await this.read()
      await fs.writeFile(backupPath, JSON.stringify(data, null, 2))

      // Clean up old backups
      await this.cleanupOldBackups(backupDir, filename)
    } catch (error) {
      console.warn('Failed to create backup:', error)
    }
  }

  private async cleanupOldBackups(backupDir: string, filename: string): Promise<void> {
    try {
      const config = getConfig()
      const files = await fs.readdir(backupDir)
      const backupFiles = files
        .filter(file => file.startsWith(filename) && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file),
          stat: fs.stat(path.join(backupDir, file))
        }))

      if (backupFiles.length > config.maxBackupFiles) {
        const statsPromises = backupFiles.map(async file => ({
          ...file,
          stat: await file.stat
        }))
        
        const filesWithStats = await Promise.all(statsPromises)
        filesWithStats.sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime())

        const filesToDelete = filesWithStats.slice(0, filesWithStats.length - config.maxBackupFiles)
        await Promise.all(filesToDelete.map(file => fs.unlink(file.path)))
      }
    } catch (error) {
      console.warn('Failed to cleanup old backups:', error)
    }
  }

  async read<T = any>(): Promise<T | null> {
    try {
      const cacheKey = this.getCacheKey()
      
      // Return cached data if available
      if (this.cacheEnabled && this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey)
      }

      await this.ensureDirectoryExists()
      
      try {
        const data = await fs.readFile(this.filePath, 'utf-8')
        const parsed = JSON.parse(data)
        
        // Cache the data
        if (this.cacheEnabled) {
          this.cache.set(cacheKey, parsed)
        }
        
        return parsed
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw error
      }
    } catch (error) {
      console.error(`Error reading file ${this.filePath}:`, error)
      throw error
    }
  }

  async write<T = any>(data: T): Promise<void> {
    try {
      await this.ensureDirectoryExists()
      await this.createBackup()
      
      const jsonString = JSON.stringify(data, null, 2)
      await fs.writeFile(this.filePath, jsonString, 'utf-8')
      
      // Update cache
      if (this.cacheEnabled) {
        const cacheKey = this.getCacheKey()
        this.cache.set(cacheKey, data)
      }
    } catch (error) {
      console.error(`Error writing file ${this.filePath}:`, error)
      throw error
    }
  }

  async update<T = any>(updateFn: (data: T | null) => T): Promise<T> {
    const currentData = await this.read<T>()
    const newData = updateFn(currentData)
    await this.write(newData)
    return newData
  }

  async delete(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
      
      // Clear cache
      if (this.cacheEnabled) {
        const cacheKey = this.getCacheKey()
        this.cache.delete(cacheKey)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Error deleting file ${this.filePath}:`, error)
        throw error
      }
    }
  }

  clearCache(): void {
    const cacheKey = this.getCacheKey()
    this.cache.delete(cacheKey)
  }
}

// Enhanced TaskManager with environment configuration
class TaskManager {
  private fileManager: JsonFileManager

  constructor() {
    const config = getConfig()
    this.fileManager = new JsonFileManager(config.tasksDataPath, {
      backupEnabled: config.backupEnabled,
      cacheEnabled: config.cacheEnabled
    })
  }

  async getTasks(filters?: Partial<Task>, options?: { limit?: number; offset?: number }): Promise<Task[]> {
    const tasks = await this.fileManager.read<Task[]>() || []
    
    let filtered = tasks

    // Apply filters
    if (filters) {
      filtered = tasks.filter(task => {
        return Object.entries(filters).every(([key, value]) => {
          if (value === undefined || value === null) return true
          return task[key as keyof Task] === value
        })
      })
    }

    // Apply pagination
    if (options?.offset) {
      filtered = filtered.slice(options.offset)
    }
    if (options?.limit) {
      filtered = filtered.slice(0, options.limit)
    }

    return filtered
  }

  async getTaskById(id: number): Promise<Task | null> {
    const tasks = await this.fileManager.read<Task[]>() || []
    return tasks.find(task => task.id === id) || null
  }

  async createTask(taskData: Omit<Task, 'id'>): Promise<Task> {
    const tasks = await this.fileManager.read<Task[]>() || []
    
    const newId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1
    const newTask: Task = {
      id: newId,
      ...taskData,
      createdDate: new Date().toISOString()
    }

    tasks.push(newTask)
    await this.fileManager.write(tasks)
    
    return newTask
  }

  async updateTask(id: number, updates: Partial<Task>): Promise<Task | null> {
    const tasks = await this.fileManager.read<Task[]>() || []
    const taskIndex = tasks.findIndex(task => task.id === id)
    
    if (taskIndex === -1) return null

    const updatedTask = { ...tasks[taskIndex], ...updates, id }
    tasks[taskIndex] = updatedTask
    
    await this.fileManager.write(tasks)
    return updatedTask
  }

  async deleteTask(id: number): Promise<boolean> {
    const tasks = await this.fileManager.read<Task[]>() || []
    const filteredTasks = tasks.filter(task => task.id !== id)
    
    if (filteredTasks.length === tasks.length) return false
    
    await this.fileManager.write(filteredTasks)
    return true
  }

  async completeTask(id: number): Promise<Task | null> {
    const task = await this.getTaskById(id)
    if (!task) return null

    const updates: Partial<Task> = {
      completed: true,
      completionHistory: [
        ...(task.completionHistory || []),
        new Date().toISOString()
      ]
    }

    // Handle recurring tasks
    if (task.frequency && !task.completed) {
      const nextDueDate = this.calculateNextDueDate(task.dueDate, task.frequency)
      if (nextDueDate) {
        updates.nextDueDate = nextDueDate
        updates.completed = false // Keep recurring task active
      }
    }

    return this.updateTask(id, updates)
  }

  private calculateNextDueDate(currentDue: string, frequency: string): string | null {
    const currentDate = new Date(currentDue)
    
    switch (frequency.toLowerCase()) {
      case 'daily':
        currentDate.setDate(currentDate.getDate() + 1)
        break
      case 'every 2 days':
        currentDate.setDate(currentDate.getDate() + 2)
        break
      case 'weekly once':
        currentDate.setDate(currentDate.getDate() + 7)
        break
      case 'weekly twice':
        currentDate.setDate(currentDate.getDate() + 3.5)
        break
      case 'monthly once':
        currentDate.setMonth(currentDate.getMonth() + 1)
        break
      case 'monthly twice':
        currentDate.setDate(currentDate.getDate() + 15)
        break
      case '2 months once':
        currentDate.setMonth(currentDate.getMonth() + 2)
        break
      case '3 months once':
        currentDate.setMonth(currentDate.getMonth() + 3)
        break
      case 'yearly':
        currentDate.setFullYear(currentDate.getFullYear() + 1)
        break
      case 'every 2 years':
        currentDate.setFullYear(currentDate.getFullYear() + 2)
        break
      default:
        return null
    }
    
    return currentDate.toISOString()
  }

  async importTasks(importData: any[]): Promise<{ successCount: number; skippedCount: number; invalidCount: number }> {
    const tasks = await this.fileManager.read<Task[]>() || []
    const existingIds = new Set(tasks.map(t => t.id))
    
    let successCount = 0
    let skippedCount = 0
    let invalidCount = 0

    for (const item of importData) {
      // Validate task data
      if (!item.description || !item.dueDate) {
        invalidCount++
        continue
      }

      // Skip if already exists
      if (item.id && existingIds.has(item.id)) {
        skippedCount++
        continue
      }

      // Create new task
      try {
        await this.createTask({
          description: item.description,
          dueDate: item.dueDate,
          category: item.category || 'todo',
          priority: item.priority || 'medium',
          completed: item.completed || false,
          frequency: item.frequency || null,
          reminderOffset: item.reminderOffset || null,
          nextDueDate: item.nextDueDate || null
        })
        successCount++
      } catch (error) {
        invalidCount++
      }
    }

    return { successCount, skippedCount, invalidCount }
  }
}

// Settings Manager with environment configuration
class SettingsManager {
  private fileManager: JsonFileManager

  constructor() {
    const config = getConfig()
    this.fileManager = new JsonFileManager(config.settingsPath, {
      backupEnabled: config.backupEnabled,
      cacheEnabled: config.cacheEnabled
    })
  }

  async loadSettings(): Promise<AppSettings | null> {
    return this.fileManager.read<AppSettings>()
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.fileManager.write(settings)
  }

  // Database configuration methods
  getDatabaseUrl(environment?: 'dev' | 'test' | 'prod'): string {
    const config = getConfig()
    
    switch (environment) {
      case 'dev':
        return config.databaseUrlDev
      case 'test':
        return config.databaseUrlTest
      case 'prod':
        return config.databaseUrlProd
      default:
        return config.databaseUrl || config.databaseUrlDev
    }
  }

  async updateDatabaseConfig(environment: 'dev' | 'test' | 'prod', url: string): Promise<void> {
    // In a real application, this would update environment variables
    // For now, we'll store it in the settings file
    const settings = await this.loadSettings() || {
      voice: {
        selectedVoice: 'Microsoft Prabhat - English (India)',
        rate: 1.0,
        pitch: 1.0,
        volume: 0.8
      },
      announcements: {
        enabled: true,
        morningTime: '09:00',
        eveningTime: '18:00',
        muted: false
      },
      system: {
        masterVolume: 0.7,
        taskDataPath: '/public/data/tasks.json',
        backupEnabled: true
      }
    }

    // Add database config to settings
    const updatedSettings = {
      ...settings,
      database: {
        ...((settings as any).database || {}),
        [environment]: url
      }
    }

    await this.saveSettings(updatedSettings)
  }

  getConfiguredPaths(): {
    tasksDataPath: string
    settingsPath: string
    backupDirectory: string
    exportDirectory: string
  } {
    const config = getConfig()
    return {
      tasksDataPath: config.tasksDataPath,
      settingsPath: config.settingsPath,
      backupDirectory: config.backupDirectory,
      exportDirectory: config.exportDirectory
    }
  }
}

export { TaskManager, JsonFileManager, SettingsManager, getConfig }
export type { Task, VoiceSettings, AnnouncementSettings, SystemSettings, AppSettings }