import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import crypto from 'crypto';

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
  name: string;
  lang: string;
  voiceURI: string;
  volume: number;
  rate: number;
  pitch: number;
}

export interface AnnouncementSettings {
  enabled: boolean;
  morning: boolean;
  evening: boolean;
}

export interface SystemSettings {
  volume: number;
}

export interface AppSettings {
  voice?: VoiceSettings;
  announcements?: AnnouncementSettings;
  system?: SystemSettings;
  updatedAt?: string;
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
  private options: Required<JsonFileOptions>;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private lockFiles: Set<string> = new Set();

  /**
   * Initialize the JSON file manager with configuration options
   */
  constructor(options: JsonFileOptions = {}) {
    // Load configuration from environment variables
    const envDataDir = process.env.JSON_DATA_DIR || process.env.DATA_DIR;
    const envBackups = process.env.JSON_CREATE_BACKUPS;
    const envPrettyPrint = process.env.JSON_PRETTY_PRINT;
    const envMaxBackups = process.env.JSON_MAX_BACKUPS;
    const envEnableCache = process.env.JSON_ENABLE_CACHE;
    const envCacheTtl = process.env.JSON_CACHE_TTL;

    this.options = {
      dataDir: options.dataDir || envDataDir || './public/data',
      createBackups: options.createBackups ?? (envBackups ? envBackups === 'true' : true),
      prettyPrint: options.prettyPrint ?? (envPrettyPrint ? envPrettyPrint === 'true' : true),
      maxBackups: options.maxBackups ?? (envMaxBackups ? parseInt(envMaxBackups) : 5),
      enableCache: options.enableCache ?? (envEnableCache ? envEnableCache === 'true' : true),
      cacheTtl: options.cacheTtl ?? (envCacheTtl ? parseInt(envCacheTtl) : 300000), // 5 minutes
      fileExtension: options.fileExtension ?? '.json'
    };

    this.ensureDataDirectory();
  }

  /**
   * Ensure the data directory exists
   */
  private ensureDataDirectory(): void {
    try {
      if (!fs.existsSync(this.options.dataDir)) {
        fs.mkdirSync(this.options.dataDir, { recursive: true });
      }
    } catch (error) {
      throw new Error(`Failed to create data directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the full file path for a given filename
   */
  private getFilePath(filename: string): string {
    const sanitizedFilename = this.sanitizeFilename(filename);
    if (!sanitizedFilename.endsWith(this.options.fileExtension)) {
      return path.join(this.options.dataDir, sanitizedFilename + this.options.fileExtension);
    }
    return path.join(this.options.dataDir, sanitizedFilename);
  }

  /**
   * Sanitize filename to prevent path traversal attacks
   */
  private sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Generate a unique ETag for cache validation
   */
  private generateETag(data: any): string {
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Check if cache entry is valid
   */
  private isCacheValid(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp < this.options.cacheTtl;
  }

  /**
   * Acquire a file lock to prevent concurrent access
   */
  private async acquireLock(filename: string): Promise<void> {
    const lockKey = this.getFilePath(filename);
    
    while (this.lockFiles.has(lockKey)) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.lockFiles.add(lockKey);
  }

  /**
   * Release a file lock
   */
  private releaseLock(filename: string): void {
    const lockKey = this.getFilePath(filename);
    this.lockFiles.delete(lockKey);
  }

  /**
   * Create a backup of the file before writing
   */
  private async createBackup(filePath: string): Promise<void> {
    if (!this.options.createBackups || !fs.existsSync(filePath)) {
      return;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filePath}.backup-${timestamp}`;
      await promisify(fs.copyFile)(filePath, backupPath);

      // Clean up old backups
      await this.cleanupOldBackups(filePath);
    } catch (error) {
      console.warn(`Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clean up old backup files
   */
  private async cleanupOldBackups(filePath: string): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      const basename = path.basename(filePath);
      const files = await promisify(fs.readdir)(dir);
      
      const backupFiles = files
        .filter(file => file.startsWith(`${basename}.backup-`))
        .map(file => ({
          name: file,
          path: path.join(dir, file),
          stats: fs.statSync(path.join(dir, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

      // Remove excess backups
      const filesToDelete = backupFiles.slice(this.options.maxBackups);
      await Promise.all(
        filesToDelete.map(file => promisify(fs.unlink)(file.path))
      );
    } catch (error) {
      console.warn(`Failed to cleanup old backups: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Read JSON file with error handling and fallbacks
   */
  async readJsonFile<T>(filename: string, fallback: T): Promise<T> {
    const filePath = this.getFilePath(filename);
    const cacheKey = filePath;

    // Check cache first
    if (this.options.enableCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      if (this.isCacheValid(cached)) {
        return cached.data as T;
      }
      this.cache.delete(cacheKey);
    }

    try {
      await this.acquireLock(filename);

      if (!fs.existsSync(filePath)) {
        return fallback;
      }

      const fileContent = await promisify(fs.readFile)(filePath, 'utf-8');
      
      if (!fileContent.trim()) {
        return fallback;
      }

      const data = JSON.parse(fileContent) as T;
      
      // Update cache
      if (this.options.enableCache) {
        this.cache.set(cacheKey, {
          data,
          timestamp: Date.now(),
          etag: this.generateETag(data)
        });
      }

      return data;
    } catch (error) {
      console.error(`Failed to read JSON file ${filePath}:`, error);
      
      // Try to recover from backup
      try {
        const recovered = await this.recoverFromBackup<T>(filePath);
        if (recovered !== null) {
          return recovered;
        }
      } catch (recoveryError) {
        console.error(`Failed to recover from backup:`, recoveryError);
      }

      return fallback;
    } finally {
      this.releaseLock(filename);
    }
  }

  /**
   * Write JSON file atomically to prevent corruption
   */
  async writeJsonFile<T>(filename: string, data: T): Promise<void> {
    const filePath = this.getFilePath(filename);
    const tempPath = `${filePath}.tmp`;

    try {
      await this.acquireLock(filename);
      
      // Create backup before writing
      await this.createBackup(filePath);

      // Write to temporary file first
      const jsonContent = this.options.prettyPrint 
        ? JSON.stringify(data, null, 2)
        : JSON.stringify(data);

      await promisify(fs.writeFile)(tempPath, jsonContent, 'utf-8');

      // Atomic move to final destination
      await promisify(fs.rename)(tempPath, filePath);

      // Update cache
      if (this.options.enableCache) {
        this.cache.set(filePath, {
          data,
          timestamp: Date.now(),
          etag: this.generateETag(data)
        });
      }
    } catch (error) {
      // Clean up temporary file if it exists
      if (fs.existsSync(tempPath)) {
        try {
          await promisify(fs.unlink)(tempPath);
        } catch (unlinkError) {
          console.warn(`Failed to cleanup temp file: ${unlinkError}`);
        }
      }
      
      throw new Error(`Failed to write JSON file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.releaseLock(filename);
    }
  }

  /**
   * Recover data from the most recent backup
   */
  private async recoverFromBackup<T>(filePath: string): Promise<T | null> {
    try {
      const dir = path.dirname(filePath);
      const basename = path.basename(filePath);
      const files = await promisify(fs.readdir)(dir);
      
      const backupFiles = files
        .filter(file => file.startsWith(`${basename}.backup-`))
        .map(file => ({
          name: file,
          path: path.join(dir, file),
          stats: fs.statSync(path.join(dir, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

      if (backupFiles.length === 0) {
        return null;
      }

      const mostRecentBackup = backupFiles[0];
      const backupContent = await promisify(fs.readFile)(mostRecentBackup.path, 'utf-8');
      const data = JSON.parse(backupContent) as T;

      // Restore the backup to the original file
      await promisify(fs.copyFile)(mostRecentBackup.path, filePath);

      return data;
    } catch (error) {
      console.error(`Failed to recover from backup:`, error);
      return null;
    }
  }

  /**
   * Get file statistics
   */
  async getFileStats(filename: string): Promise<JsonFileStats | null> {
    const filePath = this.getFilePath(filename);
    
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stats = await promisify(fs.stat)(filePath);
      const data = await this.readJsonFile(filename, []);
      
      const dir = path.dirname(filePath);
      const basename = path.basename(filePath);
      const files = await promisify(fs.readdir)(dir);
      const backupCount = files.filter(file => file.startsWith(`${basename}.backup-`)).length;

      return {
        fileSize: stats.size,
        recordCount: Array.isArray(data) ? data.length : Object.keys(data).length,
        lastModified: stats.mtime,
        backupCount
      };
    } catch (error) {
      console.error(`Failed to get file stats:`, error);
      return null;
    }
  }

  /**
   * Perform batch operations on JSON data
   */
  async batchOperation<T extends { id?: number | string }>(
    filename: string,
    operations: BatchOperation<T>[],
    fallback: T[] = []
  ): Promise<T[]> {
    let data = await this.readJsonFile<T[]>(filename, fallback);
    
    for (const operation of operations) {
      switch (operation.type) {
        case 'create':
          if (operation.data) {
            data.push(operation.data);
          }
          break;
          
        case 'update':
          if (operation.id && operation.data) {
            const index = data.findIndex(item => item.id === operation.id);
            if (index !== -1) {
              data[index] = { ...data[index], ...operation.data };
            }
          }
          break;
          
        case 'delete':
          if (operation.id) {
            data = data.filter(item => item.id !== operation.id);
          }
          break;
      }
    }
    
    await this.writeJsonFile(filename, data);
    return data;
  }

  /**
   * Clear cache for a specific file or all files
   */
  clearCache(filename?: string): void {
    if (filename) {
      const filePath = this.getFilePath(filename);
      this.cache.delete(filePath);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get database connection URL from environment variables
   */
  static getDatabaseUrl(): string | null {
    return process.env.DATABASE_URL || 
           process.env.MONGODB_URI || 
           process.env.MONGO_URL || 
           null;
  }

  /**
   * Check if database should be used based on environment
   */
  static shouldUseDatabase(): boolean {
    const dbUrl = JsonFileManager.getDatabaseUrl();
    const forceJson = process.env.FORCE_JSON_STORAGE === 'true';
    return !forceJson && !!dbUrl;
  }
}

/**
 * Task-specific operations built on top of JsonFileManager
 */
export class TaskManager extends JsonFileManager {
  private static readonly TASKS_FILE = 'tasks';

  /**
   * Get the next available task ID
   */
  private async getNextId(): Promise<number> {
    const tasks = await this.readJsonFile<Task[]>(TaskManager.TASKS_FILE, []);
    const maxId = tasks.reduce((max, task) => Math.max(max, task.id || 0), 0);
    return maxId + 1;
  }

  /**
   * Validate task data
   */
  private validateTask(task: Partial<Task>): void {
    if (!task.description || task.description.trim().length === 0) {
      throw new Error('Task description is required');
    }
    
    if (task.priority && !['low', 'medium', 'high'].includes(task.priority)) {
      throw new Error('Invalid priority level');
    }
    
    if (task.dueDate && isNaN(Date.parse(task.dueDate))) {
      throw new Error('Invalid due date format');
    }
  }

  /**
   * Create a new task
   */
  async createTask(taskData: Omit<Task, 'id' | 'createdDate'>): Promise<Task> {
    this.validateTask(taskData);
    
    const now = new Date().toISOString();
    const newTask: Task = {
      ...taskData,
      id: await this.getNextId(),
      createdDate: now,
      completed: taskData.completed || false
    };

    const tasks = await this.readJsonFile<Task[]>(TaskManager.TASKS_FILE, []);
    tasks.push(newTask);
    await this.writeJsonFile(TaskManager.TASKS_FILE, tasks);

    return newTask;
  }

  /**
   * Get all tasks with optional filtering
   */
  async getAllTasks(filters?: {
    limit?: number;
    offset?: number;
    search?: string;
    category?: string;
    priority?: string;
    completed?: boolean;
    sort?: string;
    order?: string;
  }): Promise<Task[]> {
    let tasks = await this.readJsonFile<Task[]>(TaskManager.TASKS_FILE, []);

    // Apply filters
    if (filters) {
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        tasks = tasks.filter(task => 
          task.description.toLowerCase().includes(searchTerm)
        );
      }

      if (filters.category) {
        tasks = tasks.filter(task => task.category === filters.category);
      }

      if (filters.priority) {
        tasks = tasks.filter(task => task.priority === filters.priority);
      }

      if (filters.completed !== undefined) {
        tasks = tasks.filter(task => task.completed === filters.completed);
      }

      // Apply sorting
      if (filters.sort) {
        const sortField = filters.sort;
        const order = filters.order || 'desc';
        
        tasks.sort((a, b) => {
          let aVal: any, bVal: any;
          
          switch (sortField) {
            case 'dueDate':
              aVal = new Date(a.dueDate).getTime();
              bVal = new Date(b.dueDate).getTime();
              break;
            case 'createdDate':
              aVal = new Date(a.createdDate || 0).getTime();
              bVal = new Date(b.createdDate || 0).getTime();
              break;
            case 'priority':
              const priorityOrder = { low: 1, medium: 2, high: 3 };
              aVal = priorityOrder[a.priority];
              bVal = priorityOrder[b.priority];
              break;
            default:
              aVal = (a as any)[sortField];
              bVal = (b as any)[sortField];
          }
          
          if (order === 'asc') {
            return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          } else {
            return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
          }
        });
      }

      // Apply pagination
      if (filters.offset || filters.limit) {
        const offset = filters.offset || 0;
        const limit = filters.limit || tasks.length;
        tasks = tasks.slice(offset, offset + limit);
      }
    }

    return tasks;
  }

  /**
   * Get a specific task by ID
   */
  async getTaskById(id: number): Promise<Task | null> {
    const tasks = await this.getAllTasks();
    return tasks.find(task => task.id === id) || null;
  }

  /**
   * Update an existing task
   */
  async updateTask(id: number, updates: Partial<Omit<Task, 'id'>>): Promise<Task | null> {
    this.validateTask(updates);
    
    const tasks = await this.readJsonFile<Task[]>(TaskManager.TASKS_FILE, []);
    const taskIndex = tasks.findIndex(task => task.id === id);
    
    if (taskIndex === -1) {
      return null;
    }

    const updatedTask: Task = {
      ...tasks[taskIndex],
      ...updates
    };

    tasks[taskIndex] = updatedTask;
    await this.writeJsonFile(TaskManager.TASKS_FILE, tasks);

    return updatedTask;
  }

  /**
   * Delete a task
   */
  async deleteTask(id: number): Promise<Task | null> {
    const tasks = await this.readJsonFile<Task[]>(TaskManager.TASKS_FILE, []);
    const taskIndex = tasks.findIndex(task => task.id === id);
    
    if (taskIndex === -1) {
      return null;
    }

    const deletedTask = tasks[taskIndex];
    tasks.splice(taskIndex, 1);
    await this.writeJsonFile(TaskManager.TASKS_FILE, tasks);

    return deletedTask;
  }

  /**
   * Mark task as completed with recurrence handling
   */
  async completeTask(id: number): Promise<Task | null> {
    const task = await this.getTaskById(id);
    if (!task) return null;

    const currentTimestamp = new Date().toISOString();
    let completionHistory = task.completionHistory || [];
    completionHistory.push(currentTimestamp);

    let updateData: Partial<Task> = {
      completed: true,
      completionHistory
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
        case 'Every 2 Days':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setDate(currentDueDate.getDate() + 2);
          break;
        case 'Weekly Once':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setDate(currentDueDate.getDate() + 7);
          break;
        case 'Weekly Twice':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setDate(currentDueDate.getDate() + 3);
          break;
        case 'Monthly Once':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setMonth(currentDueDate.getMonth() + 1);
          break;
        case 'Monthly Twice':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setDate(currentDueDate.getDate() + 15);
          break;
        case '2 Months Once':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setMonth(currentDueDate.getMonth() + 2);
          break;
        case '3 Months Once':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setMonth(currentDueDate.getMonth() + 3);
          break;
        case 'Yearly':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setFullYear(currentDueDate.getFullYear() + 1);
          break;
        case 'Every 2 Years':
          nextDueDate = new Date(currentDueDate);
          nextDueDate.setFullYear(currentDueDate.getFullYear() + 2);
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

    return await this.updateTask(id, updateData);
  }

  /**
   * Import tasks from external data
   */
  async importTasks(importData: { tasks: Omit<Task, 'id'>[] }): Promise<{
    success: boolean;
    imported: number;
    failed: number;
    errors: string[];
  }> {
    const result = {
      success: false,
      imported: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (let i = 0; i < importData.tasks.length; i++) {
      try {
        await this.createTask(importData.tasks[i]);
        result.imported++;
      } catch (error) {
        result.failed++;
        result.errors.push(`Task ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    result.success = result.imported > 0;
    return result;
  }

  /**
   * Export all tasks
   */
  async exportTasks(): Promise<{
    exportedAt: string;
    totalTasks: number;
    tasks: Task[];
  }> {
    const tasks = await this.getAllTasks();
    return {
      exportedAt: new Date().toISOString(),
      totalTasks: tasks.length,
      tasks
    };
  }
}

/**
 * Settings Manager for application configuration
 */
export class SettingsManager extends JsonFileManager {
  private static readonly SETTINGS_FILE = 'settings';

  /**
   * Get all settings
   */
  async getSettings(): Promise<AppSettings> {
    return await this.readJsonFile<AppSettings>(SettingsManager.SETTINGS_FILE, {});
  }

  /**
   * Update settings
   */
  async updateSettings(settings: AppSettings): Promise<AppSettings> {
    const updatedSettings = {
      ...settings,
      updatedAt: new Date().toISOString()
    };
    
    await this.writeJsonFile(SettingsManager.SETTINGS_FILE, updatedSettings);
    return updatedSettings;
  }
}

// Export singleton instances for convenience
export const jsonFileManager = new JsonFileManager();
export const taskManager = new TaskManager();
export const settingsManager = new SettingsManager();