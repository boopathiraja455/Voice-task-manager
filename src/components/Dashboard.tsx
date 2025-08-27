"use client"

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Clock3, Calendar, ListTodo, CalendarX2, CalendarCheck2, ClockAlert, CalendarDays, Clock1, CalendarFold, Timer, CalendarClock, ListFilter, ChartGantt, CalendarSearch, CalendarPlus, Volume2, Clock4, Repeat, ShoppingCart, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

interface Task {
  id: number
  description: string
  dueDate: string
  category: string
  priority: 'low' | 'medium' | 'high'
  completed: boolean
  frequency?: string
  createdDate?: string
  completionHistory?: string[]
  reminderOffset?: number
  nextDueDate?: string
}

interface VoicePreference {
  name: string
  lang: string
  voiceURI: string
}

interface VoiceSettings {
  voiceURI: string
  volume: number
  rate: number
  pitch: number
}

type FilterType = 'all' | 'due-today' | 'overdue' | 'completed' | 'by-category'
type SortType = 'due-date' | 'priority' | 'category' | 'created'

const FREQUENCIES = [
  'Daily',
  'Every 2 Days',
  'Weekly Once',
  'Weekly Twice',
  'Monthly Once',
  'Monthly Twice',
  '2 Months Once',
  '3 Months Once',
  'Yearly',
  'Every 2 Years'
]

const CATEGORIES = ['reminders', 'todo', 'shopping', 'work', 'personal', 'health', 'finance', 'learning', 'other']

// Category configuration for display order and styling
const CATEGORY_CONFIG = {
  reminders: {
    label: 'Repetitive Reminders',
    icon: Repeat,
    color: 'bg-blue-500/10 border-blue-500/20',
    order: 1
  },
  todo: {
    label: 'Todo Tasks',
    icon: ListTodo,
    color: 'bg-green-500/10 border-green-500/20',
    order: 2
  },
  shopping: {
    label: 'Shopping & Dues',
    icon: ShoppingCart,
    color: 'bg-purple-500/10 border-purple-500/20',
    order: 3
  },
  work: {
    label: 'Work Tasks',
    icon: CalendarClock,
    color: 'bg-orange-500/10 border-orange-500/20',
    order: 4
  },
  personal: {
    label: 'Personal Tasks',
    icon: Calendar,
    color: 'bg-pink-500/10 border-pink-500/20',
    order: 5
  },
  health: {
    label: 'Health & Wellness',
    icon: AlertCircle,
    color: 'bg-red-500/10 border-red-500/20',
    order: 6
  },
  finance: {
    label: 'Financial Tasks',
    icon: CalendarDays,
    color: 'bg-yellow-500/10 border-yellow-500/20',
    order: 7
  },
  learning: {
    label: 'Learning & Development',
    icon: CalendarFold,
    color: 'bg-indigo-500/10 border-indigo-500/20',
    order: 8
  },
  other: {
    label: 'Other Tasks',
    icon: CalendarX2,
    color: 'bg-gray-500/10 border-gray-500/20',
    order: 9
  }
}

export default function Dashboard() {
  // Core state
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  
  // UI state
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortType>('due-date')
  const [showCompleted, setShowCompleted] = useState(true)
  
  // Modals and dialogs
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false)
  
  // Speech and announcements
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoice, setSelectedVoice] = useState<VoicePreference | null>(null)
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(true)
  const [morningAnnouncementEnabled, setMorningAnnouncementEnabled] = useState(true)
  const [eveningAnnouncementEnabled, setEveningAnnouncementEnabled] = useState(true)
  const [speechVolume, setSpeechVolume] = useState(0.8)
  const [speechRate, setSpeechRate] = useState(0.9)
  const [speechPitch, setSpeechPitch] = useState(1.0)
  const [systemVolume, setSystemVolume] = useState(0.8)
  
  // Precise timing and scheduling
  const [currentTime, setCurrentTime] = useState(new Date())
  const [nextAnnouncementTime, setNextAnnouncementTime] = useState<Date | null>(null)
  const [schedulingLog, setSchedulingLog] = useState<string[]>([])
  
  // Refs for cleanup
  const timeUpdateInterval = useRef<NodeJS.Timeout | null>(null)
  const announcementTimeouts = useRef<NodeJS.Timeout[]>([])
  
  // Form state
  const [newTaskForm, setNewTaskForm] = useState({
    description: '',
    dueDate: '',
    category: 'todo',
    priority: 'medium' as Task['priority'],
    frequency: ''
  })
  
  const [rescheduleForm, setRescheduleForm] = useState({
    dueDate: '',
    frequency: ''
  })

  // Logging utility
  const logEvent = useCallback((message: string, type: 'info' | 'warning' | 'error' = 'info') => {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] ${type.toUpperCase()}: ${message}`
    
    console.log(logMessage)
    setSchedulingLog(prev => [...prev.slice(-49), logMessage]) // Keep last 50 logs
    
    if (type === 'error') {
      toast.error('System Error', { description: message })
    }
  }, [])

  // Load settings from JSON file
  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const result = await response.json()
        const settings = result.data
        
        if (settings?.voice) {
          setSelectedVoice(settings.voice)
          setSpeechVolume(settings.voice.volume || 0.8)
          setSpeechRate(settings.voice.rate || 0.9)
          setSpeechPitch(settings.voice.pitch || 1.0)
        }
        
        if (settings?.announcements) {
          setAnnouncementsEnabled(settings.announcements.enabled ?? true)
          setMorningAnnouncementEnabled(settings.announcements.morning ?? true)  
          setEveningAnnouncementEnabled(settings.announcements.evening ?? true)
        }
        
        if (settings?.system) {
          setSystemVolume(settings.system.masterVolume || 0.8)
        }
        
        logEvent('Settings loaded from JSON file')
      }
    } catch (error) {
      logEvent('Failed to load settings, using defaults', 'warning')
    }
  }, [logEvent])

  // Save settings to JSON file
  const saveSettings = useCallback(async () => {
    try {
      const settings = {
        voice: {
          selectedVoice: selectedVoice?.name || 'Microsoft Prabhat - English (India)',
          rate: speechRate,
          pitch: speechPitch,
          volume: speechVolume
        },
        announcements: {
          enabled: announcementsEnabled,
          morningTime: '09:00',
          eveningTime: '18:00',
          muted: !announcementsEnabled
        },
        system: {
          masterVolume: systemVolume,
          taskDataPath: '/public/data/tasks.json',
          backupEnabled: true
        }
      }

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })

      if (response.ok) {
        logEvent('Settings saved to JSON file')
      } else {
        throw new Error('Failed to save settings')
      }
    } catch (error) {
      logEvent('Failed to save settings', 'error')
    }
  }, [selectedVoice, speechVolume, speechRate, speechPitch, announcementsEnabled, morningAnnouncementEnabled, eveningAnnouncementEnabled, systemVolume, logEvent])

  // Data fetching with enhanced error handling
  const fetchTasks = useCallback(async (retryCount = 0) => {
    try {
      setLoading(true)
      setError(null)
      
      logEvent('Fetching tasks from server...')
      
      const response = await fetch('/api/tasks')
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.status}`)
      }
      
      const data = await response.json()
      
      // Validate and sanitize fetched data
      const validTasks = data.filter((task: any) => {
        if (!task.id || !task.description || !task.dueDate) {
          logEvent(`Skipping malformed task: ${JSON.stringify(task)}`, 'warning')
          return false
        }
        return true
      })
      
      setTasks(validTasks)
      logEvent(`Successfully fetched ${validTasks.length} tasks`)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load tasks'
      setError(errorMessage)
      logEvent(`Task fetch failed: ${errorMessage}`, 'error')
      
      // Retry logic for network instability
      if (retryCount < 3) {
        logEvent(`Retrying task fetch (attempt ${retryCount + 1}/3)...`)
        setTimeout(() => fetchTasks(retryCount + 1), 2000 * (retryCount + 1))
        return
      }
      
      toast.error('Failed to load tasks', {
        description: errorMessage,
        action: {
          label: 'Retry',
          onClick: () => fetchTasks()
        }
      })
    } finally {
      setLoading(false)
    }
  }, [logEvent])

  // Listen for custom refresh events (avoiding page reloads)
  useEffect(() => {
    const handleRefreshTasks = () => {
      logEvent('Received refresh tasks event - updating without page reload')
      fetchTasks()
    }

    window.addEventListener('refreshTasks', handleRefreshTasks)
    return () => window.removeEventListener('refreshTasks', handleRefreshTasks)
  }, [fetchTasks, logEvent])

  // Initialize data and speech
  useEffect(() => {
    fetchTasks()
    loadSettings()
  }, [fetchTasks, loadSettings])

  // Save settings whenever they change
  useEffect(() => {
    if (selectedVoice) {
      saveSettings()
    }
  }, [selectedVoice, speechVolume, speechRate, speechPitch, announcementsEnabled, morningAnnouncementEnabled, eveningAnnouncementEnabled, systemVolume, saveSettings])

  // Current time tracking for precise scheduling
  useEffect(() => {
    timeUpdateInterval.current = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000) // Update every second for precision

    return () => {
      if (timeUpdateInterval.current) {
        clearInterval(timeUpdateInterval.current)
      }
    }
  }, [])

  // Initialize speech synthesis with Microsoft Prabhat (en-IN) as default
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices()
      setVoices(availableVoices)
      
      // Only set default voice if no voice is currently selected
      if (!selectedVoice && availableVoices.length > 0) {
        // Default to Microsoft Prabhat (en-IN) or closest match
        const prabhatVoice = availableVoices.find(voice => 
          voice.name.toLowerCase().includes('prabhat') && voice.lang === 'en-IN'
        )
        
        const preferredVoice = prabhatVoice || availableVoices.find(voice => 
          voice.lang === 'en-IN' || 
          (voice.name.toLowerCase().includes('microsoft') && voice.lang.startsWith('en')) ||
          (voice.name.toLowerCase().includes('natural') && voice.lang.startsWith('en'))
        ) || availableVoices.find(voice => voice.lang.startsWith('en'))
        
        if (preferredVoice) {
          setSelectedVoice({
            name: preferredVoice.name,
            lang: preferredVoice.lang,
            voiceURI: preferredVoice.voiceURI
          })
          logEvent(`Selected default voice: ${preferredVoice.name}`)
        }
      }
    }

    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
    }
  }, [selectedVoice, logEvent])

  // Enhanced separate announcements for each category
  const speakMorningAnnouncement = useCallback(() => {
    const today = new Date().toDateString()
    const todayTasks = tasks.filter(task => 
      new Date(task.dueDate).toDateString() === today && !task.completed
    )
    
    if (todayTasks.length === 0) {
      speak('Good morning! You have no tasks scheduled for today. Enjoy your day!')
      return
    }
    
    // Group tasks by category for separate announcements
    const tasksByCategory = todayTasks.reduce((acc, task) => {
      const category = task.category.toLowerCase()
      if (!acc[category]) acc[category] = []
      acc[category].push(task)
      return acc
    }, {} as Record<string, Task[]>)
    
    // Announce each category separately in order
    const announceCategory = (category: string, index: number) => {
      setTimeout(() => {
        const categoryTasks = tasksByCategory[category]
        if (categoryTasks && categoryTasks.length > 0) {
          const categoryConfig = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG]
          const categoryLabel = categoryConfig?.label || category
          const taskDescriptions = categoryTasks.map(task => task.description).join(', ')
          
          const announcement = `${categoryLabel}: ${taskDescriptions}`
          speak(announcement)
          logEvent(`Morning announcement for ${category}: ${categoryTasks.length} tasks`)
        }
      }, index * 3000) // 3 second delay between categories
    }
    
    speak('Good morning! Here are your tasks for today, organized by category:')
    
    // Announce categories in priority order
    const orderedCategories = Object.keys(tasksByCategory).sort((a, b) => {
      const configA = CATEGORY_CONFIG[a as keyof typeof CATEGORY_CONFIG]
      const configB = CATEGORY_CONFIG[b as keyof typeof CATEGORY_CONFIG]
      return (configA?.order || 999) - (configB?.order || 999)
    })
    
    orderedCategories.forEach((category, index) => {
      announceCategory(category, index + 1) // +1 to account for initial greeting
    })
    
    logEvent(`Morning announcement delivered for ${todayTasks.length} tasks across ${orderedCategories.length} categories`)
  }, [tasks, speak, logEvent])

  const speakEveningAnnouncement = useCallback(() => {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    const tomorrowTasks = tasks.filter(task => 
      new Date(task.dueDate).toDateString() === tomorrow.toDateString() && !task.completed
    )
    
    const overdueTasks = tasks.filter(task => 
      new Date(task.dueDate) < today && !task.completed
    )
    
    speak('Good evening!')
    
    // Announce tomorrow's tasks by category
    if (tomorrowTasks.length > 0) {
      const tomorrowByCategory = tomorrowTasks.reduce((acc, task) => {
        const category = task.category.toLowerCase()
        if (!acc[category]) acc[category] = []
        acc[category].push(task)
        return acc
      }, {} as Record<string, Task[]>)
      
      setTimeout(() => {
        speak(`Tomorrow's tasks by category:`)
        
        const orderedCategories = Object.keys(tomorrowByCategory).sort((a, b) => {
          const configA = CATEGORY_CONFIG[a as keyof typeof CATEGORY_CONFIG]
          const configB = CATEGORY_CONFIG[b as keyof typeof CATEGORY_CONFIG]
          return (configA?.order || 999) - (configB?.order || 999)
        })
        
        orderedCategories.forEach((category, index) => {
          setTimeout(() => {
            const categoryTasks = tomorrowByCategory[category]
            const categoryConfig = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG]
            const categoryLabel = categoryConfig?.label || category
            const taskDescriptions = categoryTasks.map(t => t.description).join(', ')
            
            speak(`${categoryLabel}: ${taskDescriptions}`)
          }, (index + 1) * 2500)
        })
      }, 1000)
    }
    
    // Announce overdue tasks by category
    if (overdueTasks.length > 0) {
      const overdueByCategory = overdueTasks.reduce((acc, task) => {
        const category = task.category.toLowerCase()
        if (!acc[category]) acc[category] = []
        acc[category].push(task)
        return acc
      }, {} as Record<string, Task[]>)
      
      const delay = tomorrowTasks.length > 0 ? (Object.keys(tomorrowByCategory).length + 2) * 2500 : 1500
      
      setTimeout(() => {
        speak(`Overdue tasks by category:`)
        
        const orderedCategories = Object.keys(overdueByCategory).sort((a, b) => {
          const configA = CATEGORY_CONFIG[a as keyof typeof CATEGORY_CONFIG]
          const configB = CATEGORY_CONFIG[b as keyof typeof CATEGORY_CONFIG]
          return (configA?.order || 999) - (configB?.order || 999)
        })
        
        orderedCategories.forEach((category, index) => {
          setTimeout(() => {
            const categoryTasks = overdueByCategory[category]
            const categoryConfig = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG]
            const categoryLabel = categoryConfig?.label || category
            const taskDescriptions = categoryTasks.map(t => t.description).join(', ')
            
            speak(`${categoryLabel}: ${taskDescriptions}`)
          }, (index + 1) * 2500)
        })
      }, delay)
    }
    
    if (tomorrowTasks.length === 0 && overdueTasks.length === 0) {
      setTimeout(() => {
        speak('No tasks scheduled for tomorrow and no overdue tasks. Great job!')
      }, 1000)
    }
    
    logEvent(`Evening announcement delivered - Tomorrow: ${tomorrowTasks.length}, Overdue: ${overdueTasks.length}`)
  }, [tasks, speak, logEvent])

  // Precise announcement scheduling
  useEffect(() => {
    if (!announcementsEnabled || typeof window === 'undefined') return

    // Clear existing timeouts
    announcementTimeouts.current.forEach(clearTimeout)
    announcementTimeouts.current = []

    const scheduleAnnouncements = () => {
      const now = new Date()
      
      // Declare times at function scope to avoid reference errors
      const morningTime = new Date(now)
      morningTime.setHours(7, 0, 0, 0)
      if (morningTime <= now) {
        morningTime.setDate(morningTime.getDate() + 1)
      }
      
      const eveningTime = new Date(now)
      eveningTime.setHours(21, 0, 0, 0)
      if (eveningTime <= now) {
        eveningTime.setDate(eveningTime.getDate() + 1)
      }
      
      // Morning announcement at 7:00 AM
      if (morningAnnouncementEnabled) {
        const morningTimeout = morningTime.getTime() - now.getTime()
        
        const timeout = setTimeout(() => {
          if (document.visibilityState === 'visible') {
            logEvent('Triggering morning announcement')
            speakMorningAnnouncement()
          }
        }, morningTimeout)
        
        announcementTimeouts.current.push(timeout)
        logEvent(`Morning announcement scheduled for ${morningTime.toLocaleString()}`)
      }
      
      // Evening announcement at 9:00 PM
      if (eveningAnnouncementEnabled) {
        const eveningTimeout = eveningTime.getTime() - now.getTime()
        
        const timeout = setTimeout(() => {
          if (document.visibilityState === 'visible') {
            logEvent('Triggering evening announcement')
            speakEveningAnnouncement()
          }
        }, eveningTimeout)
        
        announcementTimeouts.current.push(timeout)
        logEvent(`Evening announcement scheduled for ${eveningTime.toLocaleString()}`)
      }
      
      // Set next announcement time for UI display
      if (morningAnnouncementEnabled && eveningAnnouncementEnabled) {
        if (morningTime < eveningTime) {
          setNextAnnouncementTime(morningTime)
        } else {
          setNextAnnouncementTime(eveningTime)
        }
      } else if (morningAnnouncementEnabled) {
        setNextAnnouncementTime(morningTime)
      } else if (eveningAnnouncementEnabled) {
        setNextAnnouncementTime(eveningTime)
      } else {
        setNextAnnouncementTime(null)
      }
      
      // Check for due task announcements every minute
      const checkDueTasks = () => {
        const dueTasks = tasks.filter(task => {
          const taskDue = new Date(task.dueDate)
          const timeDiff = Math.abs(taskDue.getTime() - now.getTime())
          return timeDiff <= 30000 && !task.completed // Within 30 seconds
        })
        
        dueTasks.forEach(task => {
          logEvent(`Task due now: "${task.description}"`)
          speak(`Attention! Task "${task.description}" is now due.`)
        })
      }
      
      const dueCheckInterval = setInterval(checkDueTasks, 30000) // Check every 30 seconds
      
      // Clean up on unmount
      return () => {
        clearInterval(dueCheckInterval)
        announcementTimeouts.current.forEach(clearTimeout)
      }
    }

    const cleanup = scheduleAnnouncements()
    
    return cleanup
  }, [announcementsEnabled, morningAnnouncementEnabled, eveningAnnouncementEnabled, tasks, logEvent, speakMorningAnnouncement, speakEveningAnnouncement])

  // Speech functions with fallback mechanisms and system volume control
  const speak = useCallback((text: string, repeat = false) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !selectedVoice) {
      logEvent('Speech synthesis not available or no voice selected', 'warning')
      return
    }

    try {
      window.speechSynthesis.cancel()
      
      const utterance = new SpeechSynthesisUtterance(text)
      const voice = voices.find(v => v.voiceURI === selectedVoice.voiceURI)
      
      if (voice) {
        utterance.voice = voice
      }
      
      utterance.rate = speechRate
      utterance.pitch = speechPitch
      utterance.volume = speechVolume * systemVolume // Apply system volume multiplier
      
      utterance.onstart = () => logEvent(`Started speaking: "${text.substring(0, 50)}..."`)
      utterance.onend = () => {
        logEvent('Speech completed')
        
        if (repeat) {
          setTimeout(() => {
            const repeatUtterance = new SpeechSynthesisUtterance(text)
            if (voice) repeatUtterance.voice = voice
            repeatUtterance.rate = speechRate
            repeatUtterance.pitch = speechPitch
            repeatUtterance.volume = speechVolume * systemVolume
            window.speechSynthesis.speak(repeatUtterance)
          }, 2000)
        }
      }
      
      utterance.onerror = (event) => {
        logEvent(`Speech error: ${event.error}`, 'error')
        
        // Fallback: show visual notification
        toast.error('Speech Error', {
          description: `Unable to speak: "${text.substring(0, 100)}..."`
        })
      }
      
      window.speechSynthesis.speak(utterance)
    } catch (err) {
      logEvent(`Speech synthesis failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }, [selectedVoice, voices, speechVolume, speechRate, speechPitch, systemVolume, logEvent])

  // Enhanced announcement muting system
  const muteAllAnnouncements = useCallback(() => {
    window.speechSynthesis.cancel()
    setAnnouncementsEnabled(false)
    
    // Clear all scheduled announcements
    announcementTimeouts.current.forEach(clearTimeout)
    announcementTimeouts.current = []
    
    toast.success('All announcements muted')
    logEvent('All announcements muted by user')
  }, [])

  const unmuteAnnouncements = useCallback(() => {
    setAnnouncementsEnabled(true)
    toast.success('Announcements enabled')
    logEvent('Announcements re-enabled by user')
  }, [])

  const toggleSystemMute = useCallback(() => {
    const newVolume = systemVolume === 0 ? 0.8 : 0
    setSystemVolume(newVolume)
    
    if (newVolume === 0) {
      window.speechSynthesis.cancel()
      toast.success('System audio muted')
      logEvent('System audio muted')
    } else {
      toast.success('System audio unmuted')
      logEvent('System audio unmuted')
    }
  }, [systemVolume])

  // Task operations with enhanced error handling
  const markComplete = useCallback(async (taskId: number) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // Optimistic update
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, completed: true } : t
    ))

    try {
      logEvent(`Marking task ${taskId} as complete: "${task.description}"`)
      
      const response = await fetch(`/api/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        throw new Error('Failed to mark task complete')
      }

      const updatedTask = await response.json()
      
      // Update with server response
      setTasks(prev => prev.map(t => 
        t.id === taskId ? updatedTask : t
      ))

      toast.success('Task completed!', {
        description: `"${task.description}" marked as complete`
      })
      
      logEvent(`Successfully completed task ${taskId}`)
    } catch (err) {
      // Rollback optimistic update
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, completed: false } : t
      ))
      
      logEvent(`Failed to complete task ${taskId}: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
      
      toast.error('Failed to complete task', {
        description: 'Please try again',
        action: {
          label: 'Retry',
          onClick: () => markComplete(taskId)
        }
      })
    }
  }, [tasks, logEvent])

  const createTask = useCallback(async () => {
    if (!newTaskForm.description || !newTaskForm.dueDate) {
      toast.error('Please fill in all required fields')
      return
    }

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newTaskForm.description,
          dueDate: newTaskForm.dueDate,
          category: newTaskForm.category,
          priority: newTaskForm.priority,
          frequency: newTaskForm.frequency || null,
          completed: false
        })
      })

      if (!response.ok) {
        throw new Error('Failed to create task')
      }

      const newTask = await response.json()
      setTasks(prev => [...prev, newTask])
      
      setNewTaskForm({
        description: '',
        dueDate: '',
        category: 'todo',
        priority: 'medium',
        frequency: ''
      })
      
      setIsCreateTaskOpen(false)
      toast.success('Task created successfully!')
    } catch (err) {
      toast.error('Failed to create task', {
        description: 'Please try again'
      })
    }
  }, [newTaskForm])

  const rescheduleTask = useCallback(async () => {
    if (!selectedTask || !rescheduleForm.dueDate) {
      toast.error('Please select a new due date')
      return
    }

    try {
      const response = await fetch(`/api/tasks/${selectedTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectedTask,
          dueDate: rescheduleForm.dueDate,
          frequency: rescheduleForm.frequency || selectedTask.frequency
        })
      })

      if (!response.ok) {
        throw new Error('Failed to reschedule task')
      }

      const updatedTask = await response.json()
      
      setTasks(prev => prev.map(t => 
        t.id === selectedTask.id ? updatedTask : t
      ))
      
      setSelectedTask(updatedTask)
      setIsRescheduleOpen(false)
      setRescheduleForm({ dueDate: '', frequency: '' })
      
      toast.success('Task rescheduled successfully!')
    } catch (err) {
      toast.error('Failed to reschedule task', {
        description: 'Please try again'
      })
    }
  }, [selectedTask, rescheduleForm])

  // Enhanced filtering and sorting with category segregation
  const tasksByCategory = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    let filtered = tasks.filter(task => {
      const taskDate = new Date(task.dueDate)
      const isToday = taskDate.toDateString() === today.toDateString()
      const isOverdue = taskDate < today
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (!task.description.toLowerCase().includes(query) && 
            !task.category.toLowerCase().includes(query)) {
          return false
        }
      }
      
      // Status filter
      switch (activeFilter) {
        case 'due-today':
          return isToday && !task.completed
        case 'overdue':
          return isOverdue && !task.completed
        case 'completed':
          return task.completed
        case 'by-category':
          return !task.completed
        default:
          return showCompleted || !task.completed
      }
    })

    // Group tasks by category
    const grouped = filtered.reduce((acc, task) => {
      const category = task.category.toLowerCase()
      if (!acc[category]) acc[category] = []
      acc[category].push(task)
      return acc
    }, {} as Record<string, Task[]>)

    // Sort tasks within each category
    Object.keys(grouped).forEach(category => {
      grouped[category].sort((a, b) => {
        const aDate = new Date(a.dueDate)
        const bDate = new Date(b.dueDate)
        const now = new Date()
        
        switch (sortBy) {
          case 'priority': {
            const priorityOrder = { high: 3, medium: 2, low: 1 }
            return priorityOrder[b.priority] - priorityOrder[a.priority]
          }
          case 'created':
            return new Date(b.createdDate || 0).getTime() - new Date(a.createdDate || 0).getTime()
          default: // due-date
            // Overdue tasks first, then today, then future
            const aOverdue = aDate < now && !a.completed
            const bOverdue = bDate < now && !b.completed
            const aToday = aDate.toDateString() === now.toDateString()
            const bToday = bDate.toDateString() === now.toDateString()
            
            if (aOverdue && !bOverdue) return -1
            if (!aOverdue && bOverdue) return 1
            if (aToday && !bToday && !bOverdue) return -1
            if (!aToday && bToday && !aOverdue) return 1
            
            return aDate.getTime() - bDate.getTime()
        }
      })
    })

    return grouped
  }, [tasks, searchQuery, activeFilter, sortBy, showCompleted])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case '/':
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[data-search]')?.focus()
          break
        case 'c':
          if (selectedTask && !selectedTask.completed) {
            e.preventDefault()
            markComplete(selectedTask.id)
          }
          break
        case 'Enter':
          if (selectedTask) {
            e.preventDefault()
            // Toggle task selection
            setSelectedTask(selectedTask === selectedTask ? null : selectedTask)
          }
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          e.preventDefault()
          const filters: FilterType[] = ['all', 'due-today', 'overdue', 'completed', 'by-category']
          setActiveFilter(filters[parseInt(e.key) - 1])
          break
        case 'm':
          e.preventDefault()
          if (announcementsEnabled) {
            muteAllAnnouncements()
          } else {
            unmuteAnnouncements()
          }
          break
        case 'M':
          e.preventDefault()
          toggleSystemMute()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedTask, markComplete, announcementsEnabled, muteAllAnnouncements, unmuteAnnouncements, toggleSystemMute])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    if (date.toDateString() === today.toDateString()) {
      return 'Today'
    }
    
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    }
    
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow'
    }
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    })
  }

  const isOverdue = (dateString: string) => {
    const taskDate = new Date(dateString)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return taskDate < today
  }

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'high': return 'priority-high'
      case 'medium': return 'priority-medium'
      case 'low': return 'priority-low'
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-6xl mx-auto p-6">
        <div className="card-neon rounded-lg p-8">
          <div className="flex items-center justify-center space-x-2">
            <Timer className="h-5 w-5 animate-spin text-primary" />
            <span className="text-muted-foreground">Loading tasks...</span>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full max-w-6xl mx-auto p-6">
        <Card className="border-destructive card-neon">
          <CardContent className="p-8">
            <div className="flex items-center space-x-2 text-destructive mb-4">
              <CalendarX2 className="h-5 w-5" />
              <span className="font-medium">Error loading tasks</span>
            </div>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => fetchTasks()} variant="outline" className="neon-border">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Get ordered categories for display
  const orderedCategories = Object.keys(tasksByCategory).sort((a, b) => {
    const configA = CATEGORY_CONFIG[a as keyof typeof CATEGORY_CONFIG]
    const configB = CATEGORY_CONFIG[b as keyof typeof CATEGORY_CONFIG]
    return (configA?.order || 999) - (configB?.order || 999)
  })

  return (
    <div className="w-full max-w-6xl mx-auto p-6 space-y-6">
      {/* System Status Display */}
      <div className="card-neon rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Clock4 className="h-4 w-4" />
              <span className="text-sm">{currentTime.toLocaleTimeString()}</span>
            </div>
            {nextAnnouncementTime && (
              <div className="flex items-center space-x-2">
                <Volume2 className="h-4 w-4" />
                <span className="text-sm">Next: {nextAnnouncementTime.toLocaleTimeString()}</span>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant={systemVolume > 0 ? "default" : "destructive"}
              size="sm"
              onClick={toggleSystemMute}
              className={systemVolume > 0 ? "neon-glow" : ""}
            >
              <Volume2 className="h-4 w-4 mr-2" />
              {systemVolume > 0 ? 'Mute System' : 'Unmute System'}
            </Button>
            <Button
              variant={announcementsEnabled ? "default" : "outline"}
              size="sm"
              onClick={announcementsEnabled ? muteAllAnnouncements : unmuteAnnouncements}
              className={announcementsEnabled ? "neon-glow" : "neon-border"}
            >
              <Volume2 className="h-4 w-4 mr-2" />
              {announcementsEnabled ? 'Mute' : 'Unmute'}
            </Button>
          </div>
        </div>
      </div>

      {/* Header with controls */}
      <div className="card-neon rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-foreground neon-text animate-neon-pulse">Tasks by Category</h1>
          <div className="flex items-center gap-2">
            <Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="neon-glow">
                  <CalendarPlus className="h-4 w-4 mr-2" />
                  Add Task
                </Button>
              </DialogTrigger>
              <DialogContent className="card-neon">
                <DialogHeader>
                  <DialogTitle>Create New Task</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={newTaskForm.description}
                      onChange={(e) => setNewTaskForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Enter task description..."
                      className="neon-border"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dueDate">Due Date</Label>
                    <Input
                      id="dueDate"
                      type="datetime-local"
                      value={newTaskForm.dueDate}
                      onChange={(e) => setNewTaskForm(prev => ({ ...prev, dueDate: e.target.value }))}
                      className="neon-border"
                    />
                  </div>
                  <div>
                    <Label htmlFor="category">Category</Label>
                    <Select value={newTaskForm.category} onValueChange={(value) => setNewTaskForm(prev => ({ ...prev, category: value }))}>
                      <SelectTrigger className="neon-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="card-neon">
                        {CATEGORIES.map(cat => {
                          const config = CATEGORY_CONFIG[cat as keyof typeof CATEGORY_CONFIG]
                          return (
                            <SelectItem key={cat} value={cat}>
                              {config?.label || cat}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="priority">Priority</Label>
                    <Select value={newTaskForm.priority} onValueChange={(value: Task['priority']) => setNewTaskForm(prev => ({ ...prev, priority: value }))}>
                      <SelectTrigger className="neon-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="card-neon">
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="frequency">Frequency (Optional)</Label>
                    <Select value={newTaskForm.frequency} onValueChange={(value) => setNewTaskForm(prev => ({ ...prev, frequency: value }))}>
                      <SelectTrigger className="neon-border">
                        <SelectValue placeholder="Select frequency..." />
                      </SelectTrigger>
                      <SelectContent className="card-neon">
                        <SelectItem value="no-recurrence">No Recurrence</SelectItem>
                        {FREQUENCIES.map(freq => (
                          <SelectItem key={freq} value={freq}>{freq}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setIsCreateTaskOpen(false)} className="neon-border">
                      Cancel
                    </Button>
                    <Button onClick={createTask} className="neon-glow">Create Task</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            
            <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="neon-border">
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Settings
                </Button>
              </DialogTrigger>
              <DialogContent className="card-neon">
                <DialogHeader>
                  <DialogTitle>Dashboard Settings</DialogTitle>
                </DialogHeader>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-lg font-semibold">Voice Settings</Label>
                    <div className="space-y-2">
                      <Label>Voice Selection</Label>
                      <Select 
                        value={selectedVoice?.voiceURI || 'default'} 
                        onValueChange={(value) => {
                          if (value === 'default') {
                            setSelectedVoice(null)
                          } else {
                            const voice = voices.find(v => v.voiceURI === value)
                            if (voice) {
                              setSelectedVoice({
                                name: voice.name,
                                lang: voice.lang,
                                voiceURI: voice.voiceURI
                              })
                            }
                          }
                        }}
                      >
                        <SelectTrigger className="neon-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="card-neon">
                          <SelectItem value="default">Default Voice</SelectItem>
                          {voices.filter(v => v.lang.startsWith('en')).map(voice => (
                            <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                              {voice.name} ({voice.lang})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Volume</Label>
                        <Input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={speechVolume}
                          onChange={(e) => setSpeechVolume(parseFloat(e.target.value))}
                          className="neon-border"
                        />
                        <span className="text-sm text-muted-foreground">
                          {Math.round(speechVolume * 100)}%
                        </span>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Rate</Label>
                        <Input
                          type="range"
                          min="0.1"
                          max="2"
                          step="0.1"
                          value={speechRate}
                          onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                          className="neon-border"
                        />
                        <span className="text-sm text-muted-foreground">
                          {speechRate}x
                        </span>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Pitch</Label>
                        <Input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={speechPitch}
                          onChange={(e) => setSpeechPitch(parseFloat(e.target.value))}
                          className="neon-border"
                        />
                        <span className="text-sm text-muted-foreground">
                          {speechPitch}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>System Volume</Label>
                      <Input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={systemVolume}
                        onChange={(e) => setSystemVolume(parseFloat(e.target.value))}
                        className="neon-border"
                      />
                      <span className="text-sm text-muted-foreground">
                        {Math.round(systemVolume * 100)}%
                      </span>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => speak('This is a test of your selected voice settings. How does it sound?')}
                        className="neon-border"
                      >
                        <Volume2 className="h-4 w-4 mr-2" />
                        Test Voice
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => speak('Good morning! Here are your tasks for today: Update daily expenses, take vitamins, review meeting agenda.')}
                        className="neon-border"
                      >
                        Test Morning
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => speak('Good evening! Tomorrow\'s tasks: Call mom, backup files. No overdue tasks.')}
                        className="neon-border"
                      >
                        Test Evening
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-lg font-semibold">Announcement Schedule</Label>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="announcements"
                        checked={announcementsEnabled}
                        onCheckedChange={(checked) => setAnnouncementsEnabled(!!checked)}
                      />
                      <Label htmlFor="announcements">Enable Announcements</Label>
                    </div>
                    
                    {announcementsEnabled && (
                      <>
                        <div className="flex items-center space-x-2 ml-6">
                          <Checkbox
                            id="morning"
                            checked={morningAnnouncementEnabled}
                            onCheckedChange={(checked) => setMorningAnnouncementEnabled(!!checked)}
                          />
                          <Label htmlFor="morning">Morning Announcements (7:00 AM)</Label>
                        </div>
                        
                        <div className="flex items-center space-x-2 ml-6">
                          <Checkbox
                            id="evening"
                            checked={eveningAnnouncementEnabled}
                            onCheckedChange={(checked) => setEveningAnnouncementEnabled(!!checked)}
                          />
                          <Label htmlFor="evening">Evening Announcements (9:00 PM)</Label>
                        </div>
                      </>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-lg font-semibold">System Control</Label>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={muteAllAnnouncements}
                        className="neon-border flex-1"
                      >
                        Quick Mute All
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => window.speechSynthesis.cancel()}
                        className="neon-border flex-1"
                      >
                        Stop Speaking
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={toggleSystemMute}
                        className="neon-border flex-1"
                      >
                        {systemVolume > 0 ? 'System Mute' : 'System Unmute'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Keyboard shortcuts: Press 'M' to toggle announcements, 'Shift+M' for system mute
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1">
            <div className="relative">
              <CalendarSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                data-search
                placeholder="Search tasks... (Press / to focus)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 neon-border"
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Select value={sortBy} onValueChange={(value: SortType) => setSortBy(value)}>
              <SelectTrigger className="w-[140px] neon-border">
                <ChartGantt className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="card-neon">
                <SelectItem value="due-date">Due Date</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="category">Category</SelectItem>
                <SelectItem value="created">Created</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { key: 'all' as FilterType, label: 'All', icon: ListTodo },
            { key: 'due-today' as FilterType, label: 'Due Today', icon: Calendar },
            { key: 'overdue' as FilterType, label: 'Overdue', icon: ClockAlert },
            { key: 'completed' as FilterType, label: 'Completed', icon: CalendarCheck2 },
            { key: 'by-category' as FilterType, label: 'By Category', icon: ListFilter }
          ].map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant={activeFilter === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter(key)}
              className={`text-xs ${activeFilter === key ? 'neon-glow' : 'neon-border'}`}
            >
              <Icon className="h-3 w-3 mr-1" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Main Content Grid - Segregated by Category */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task Categories List */}
        <div className="lg:col-span-2 space-y-6">
          {orderedCategories.length === 0 ? (
            <Card className="card-neon">
              <CardContent className="p-8 text-center">
                <CalendarFold className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {searchQuery || activeFilter !== 'all' 
                    ? 'No tasks match your current filters' 
                    : 'No tasks found. Create your first task to get started!'}
                </p>
              </CardContent>
            </Card>
          ) : (
            orderedCategories.map(category => {
              const categoryTasks = tasksByCategory[category]
              const config = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG]
              const IconComponent = config?.icon || ListTodo
              
              return (
                <Card key={category} className={`card-neon ${config?.color || 'bg-gray-500/10 border-gray-500/20'}`}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <IconComponent className="h-5 w-5" />
                        <span>{config?.label || category}</span>
                        <Badge variant="outline" className="ml-2">
                          {categoryTasks.length}
                        </Badge>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {categoryTasks.map(task => (
                      <Card
                        key={task.id}
                        className={`cursor-pointer transition-all hover:shadow-md card-neon bg-background/50 ${
                          selectedTask?.id === task.id ? 'ring-2 ring-primary neon-glow' : ''
                        } ${task.completed ? 'opacity-60' : ''} ${
                          isOverdue(task.dueDate) && !task.completed ? 'task-overdue' : ''
                        }`}
                        onClick={() => setSelectedTask(task)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-start space-x-3">
                            <Checkbox
                              checked={task.completed}
                              onCheckedChange={() => markComplete(task.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1"
                            />
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className={`font-medium text-sm ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                                    {task.description}
                                  </p>
                                  
                                  <div className="flex items-center space-x-2 mt-2">
                                    <Badge className={`text-xs ${getPriorityColor(task.priority)}`}>
                                      {task.priority}
                                    </Badge>
                                    
                                    {task.frequency && (
                                      <Badge variant="outline" className="text-xs neon-border">
                                        <CalendarDays className="h-3 w-3 mr-1" />
                                        {task.frequency}
                                      </Badge>
                                    )}
                                    
                                    {isOverdue(task.dueDate) && !task.completed && (
                                      <Badge variant="destructive" className="text-xs">
                                        Overdue
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                
                                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                                  <Clock3 className="h-4 w-4" />
                                  <span>{formatDate(task.dueDate)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>

        {/* Task Details Panel */}
        <div className="space-y-4">
          {selectedTask ? (
            <Card className="card-neon">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Task Details</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedTask(null)}
                  >
                    ×
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Description</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedTask.description}
                  </p>
                </div>
                
                <div>
                  <Label className="text-sm font-medium">Due Date</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {new Date(selectedTask.dueDate).toLocaleString()}
                  </p>
                </div>
                
                <div>
                  <Label className="text-sm font-medium">Category</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {CATEGORY_CONFIG[selectedTask.category.toLowerCase() as keyof typeof CATEGORY_CONFIG]?.label || selectedTask.category}
                  </p>
                </div>
                
                <div>
                  <Label className="text-sm font-medium">Priority</Label>
                  <Badge className={`${getPriorityColor(selectedTask.priority)} text-xs mt-1`}>
                    {selectedTask.priority}
                  </Badge>
                </div>
                
                {selectedTask.frequency && (
                  <div>
                    <Label className="text-sm font-medium">Frequency</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedTask.frequency}
                    </p>
                  </div>
                )}
                
                {selectedTask.createdDate && (
                  <div>
                    <Label className="text-sm font-medium">Created</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {new Date(selectedTask.createdDate).toLocaleDateString()}
                    </p>
                  </div>
                )}
                
                <div className="space-y-2 pt-4">
                  {!selectedTask.completed && (
                    <>
                      <Button 
                        className="w-full neon-glow" 
                        onClick={() => markComplete(selectedTask.id)}
                      >
                        <CalendarCheck2 className="h-4 w-4 mr-2" />
                        Mark Complete
                      </Button>
                      
                      <Dialog open={isRescheduleOpen} onOpenChange={setIsRescheduleOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="w-full neon-border">
                            <Clock1 className="h-4 w-4 mr-2" />
                            Reschedule
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="card-neon">
                          <DialogHeader>
                            <DialogTitle>Reschedule Task</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <Label htmlFor="new_dueDate">New Due Date</Label>
                              <Input
                                id="new_dueDate"
                                type="datetime-local"
                                value={rescheduleForm.dueDate}
                                onChange={(e) => setRescheduleForm(prev => ({ ...prev, dueDate: e.target.value }))}
                                className="neon-border"
                              />
                            </div>
                            <div>
                              <Label htmlFor="new_frequency">Frequency</Label>
                              <Select 
                                value={rescheduleForm.frequency || selectedTask.frequency || 'no-recurrence'} 
                                onValueChange={(value) => setRescheduleForm(prev => ({ ...prev, frequency: value === 'no-recurrence' ? '' : value }))}
                              >
                                <SelectTrigger className="neon-border">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="card-neon">
                                  <SelectItem value="no-recurrence">No Recurrence</SelectItem>
                                  {FREQUENCIES.map(freq => (
                                    <SelectItem key={freq} value={freq}>{freq}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex justify-end space-x-2">
                              <Button 
                                variant="outline" 
                                onClick={() => setIsRescheduleOpen(false)}
                                className="neon-border"
                              >
                                Cancel
                              </Button>
                              <Button onClick={rescheduleTask} className="neon-glow">
                                Reschedule
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}
                  
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 neon-border"
                      onClick={() => speak(`Task: ${selectedTask.description}. Due: ${formatDate(selectedTask.dueDate)}. Priority: ${selectedTask.priority}. Category: ${CATEGORY_CONFIG[selectedTask.category.toLowerCase() as keyof typeof CATEGORY_CONFIG]?.label || selectedTask.category}.`)}
                    >
                      <Volume2 className="h-4 w-4 mr-1" />
                      Speak
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="card-neon">
              <CardContent className="p-8 text-center">
                <ListTodo className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Select a task to view details and actions
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}