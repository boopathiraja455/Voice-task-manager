"use client"

import React, { useState, useEffect } from 'react'
import { Moon, Sun, Volume2, Download, Upload } from 'lucide-react'
import Dashboard from '@/components/Dashboard'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export default function Page() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [announcementPrefs, setAnnouncementPrefs] = useState({
    enabled: true,
    morning: true,
    evening: true
  })

  // Initialize theme from localStorage or default to dark
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    const initialTheme = savedTheme || 'dark' // Default to dark theme
    
    setTheme(initialTheme)
    
    // Apply theme to document
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')
  }, [])

  // Load announcement preferences
  useEffect(() => {
    const savedPrefs = localStorage.getItem('announcementPrefs')
    if (savedPrefs) {
      try {
        setAnnouncementPrefs(JSON.parse(savedPrefs))
      } catch (e) {
        console.warn('Failed to parse announcement preferences:', e)
      }
    }
  }, [])

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('theme', theme)
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    localStorage.setItem('announcementPrefs', JSON.stringify(announcementPrefs))
  }, [announcementPrefs])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/tasks/import', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`Import failed: ${response.status}`)
      }

      const result = await response.json()
      
      toast.success('Import completed!', {
        description: `${result.success_count} tasks imported successfully. ${result.skipped_count} skipped, ${result.invalid_count} invalid.`
      })

      // Clear file input
      event.target.value = ''
      
      // Instead of page refresh, trigger a custom event to refresh tasks
      window.dispatchEvent(new CustomEvent('refreshTasks'))
    } catch (error) {
      console.error('Import error:', error)
      toast.error('Import failed', {
        description: error instanceof Error ? error.message : 'Please check the file format and try again'
      })
    }
  }

  const handleExport = async () => {
    try {
      const response = await fetch('/api/tasks/export')
      
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`)
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tasks_export_${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success('Tasks exported successfully!')
    } catch (error) {
      console.error('Export error:', error)
      toast.error('Export failed', {
        description: error instanceof Error ? error.message : 'Please try again'
      })
    }
  }

  const toggleAnnouncements = () => {
    setAnnouncementPrefs(prev => ({
      ...prev,
      enabled: !prev.enabled
    }))
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Navigation Bar */}
      <header className="border-b bg-card/50 backdrop-blur-sm">
        <div className="w-full max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Brand/Title */}
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-foreground">Task Manager</h1>
            </div>

            {/* Global Controls */}
            <div className="flex items-center space-x-3">
              {/* Announcement Preferences */}
              <Button
                variant={announcementPrefs.enabled ? 'default' : 'outline'}
                size="sm"
                onClick={toggleAnnouncements}
                className="hidden sm:flex"
              >
                <Volume2 className="h-4 w-4 mr-2" />
                Announcements
              </Button>

              {/* Import */}
              <div className="relative">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  id="import-file"
                />
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <label htmlFor="import-file" className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Import</span>
                  </label>
                </Button>
              </div>

              {/* Export */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
              >
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Export</span>
              </Button>

              {/* Dark/Light Toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={toggleTheme}
              >
                {theme === 'light' ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        <Dashboard />
      </main>

      {/* Bottom Status Bar */}
      <footer className="border-t bg-card/30 backdrop-blur-sm">
        <div className="w-full max-w-6xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center space-x-4">
              <span>
                Announcements: {announcementPrefs.enabled ? 'Enabled' : 'Disabled'}
              </span>
              {announcementPrefs.enabled && (
                <>
                  <span>•</span>
                  <span>
                    Morning: {announcementPrefs.morning ? '7:00 AM' : 'Off'}
                  </span>
                  <span>•</span>
                  <span>
                    Evening: {announcementPrefs.evening ? '9:00 PM' : 'Off'}
                  </span>
                </>
              )}
            </div>
            <div>
              Theme: {theme === 'light' ? 'Light' : 'Dark'}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}