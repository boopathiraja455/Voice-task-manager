import { NextRequest, NextResponse } from 'next/server';
import { SettingsManager } from '@/lib/json-storage';

const settingsManager = new SettingsManager();

interface VoiceSettings {
  selectedVoice: string;
  rate: number;
  pitch: number;
  volume: number;
}

interface AnnouncementSettings {
  enabled: boolean;
  morningTime: string;
  eveningTime: string;
  muted: boolean;
}

interface SystemSettings {
  masterVolume: number;
  taskDataPath: string;
  backupEnabled: boolean;
}

interface AppSettings {
  voice: VoiceSettings;
  announcements: AnnouncementSettings;
  system: SystemSettings;
}

const defaultSettings: AppSettings = {
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
};

export async function GET() {
  try {
    const settings = await settingsManager.loadSettings();
    
    // If no settings exist, return defaults
    if (!settings || Object.keys(settings).length === 0) {
      await settingsManager.saveSettings(defaultSettings);
      return NextResponse.json({
        success: true,
        data: defaultSettings,
        message: 'Default settings loaded'
      });
    }

    // Merge with defaults to ensure all properties exist
    const mergedSettings = {
      voice: { ...defaultSettings.voice, ...settings.voice },
      announcements: { ...defaultSettings.announcements, ...settings.announcements },
      system: { ...defaultSettings.system, ...settings.system }
    };

    return NextResponse.json({
      success: true,
      data: mergedSettings
    });
  } catch (error) {
    console.error('Error loading settings:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to load settings',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate the request body structure
    if (!body || typeof body !== 'object') {
      return NextResponse.json({
        success: false,
        error: 'Invalid request body',
        message: 'Request body must be a valid JSON object'
      }, { status: 400 });
    }

    // Load existing settings
    const existingSettings = await settingsManager.loadSettings() || {};

    // Merge new settings with existing ones, preserving structure
    const updatedSettings: AppSettings = {
      voice: {
        ...defaultSettings.voice,
        ...existingSettings.voice,
        ...body.voice
      },
      announcements: {
        ...defaultSettings.announcements,
        ...existingSettings.announcements,
        ...body.announcements
      },
      system: {
        ...defaultSettings.system,
        ...existingSettings.system,
        ...body.system
      }
    };

    // Validate voice settings
    if (updatedSettings.voice.rate < 0.1 || updatedSettings.voice.rate > 10) {
      return NextResponse.json({
        success: false,
        error: 'Invalid voice rate',
        message: 'Voice rate must be between 0.1 and 10'
      }, { status: 400 });
    }

    if (updatedSettings.voice.pitch < 0 || updatedSettings.voice.pitch > 2) {
      return NextResponse.json({
        success: false,
        error: 'Invalid voice pitch',
        message: 'Voice pitch must be between 0 and 2'
      }, { status: 400 });
    }

    if (updatedSettings.voice.volume < 0 || updatedSettings.voice.volume > 1) {
      return NextResponse.json({
        success: false,
        error: 'Invalid voice volume',
        message: 'Voice volume must be between 0 and 1'
      }, { status: 400 });
    }

    // Validate system settings
    if (updatedSettings.system.masterVolume < 0 || updatedSettings.system.masterVolume > 1) {
      return NextResponse.json({
        success: false,
        error: 'Invalid master volume',
        message: 'Master volume must be between 0 and 1'
      }, { status: 400 });
    }

    // Validate announcement times
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(updatedSettings.announcements.morningTime)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid morning time',
        message: 'Morning time must be in HH:MM format'
      }, { status: 400 });
    }

    if (!timeRegex.test(updatedSettings.announcements.eveningTime)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid evening time',
        message: 'Evening time must be in HH:MM format'
      }, { status: 400 });
    }

    // Save the updated settings
    await settingsManager.saveSettings(updatedSettings);

    return NextResponse.json({
      success: true,
      data: updatedSettings,
      message: 'Settings saved successfully'
    });
  } catch (error) {
    console.error('Error saving settings:', error);
    
    if (error instanceof SyntaxError) {
      return NextResponse.json({
        success: false,
        error: 'Invalid JSON',
        message: 'Request body contains invalid JSON'
      }, { status: 400 });
    }

    return NextResponse.json({
      success: false,
      error: 'Failed to save settings',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Load existing settings
    const existingSettings = await settingsManager.loadSettings() || defaultSettings;

    // Perform partial update - only update provided fields
    const updatedSettings = JSON.parse(JSON.stringify(existingSettings)); // Deep clone
    
    // Recursively merge only provided fields
    if (body.voice) {
      updatedSettings.voice = { ...updatedSettings.voice, ...body.voice };
    }
    
    if (body.announcements) {
      updatedSettings.announcements = { ...updatedSettings.announcements, ...body.announcements };
    }
    
    if (body.system) {
      updatedSettings.system = { ...updatedSettings.system, ...body.system };
    }

    // Save the updated settings
    await settingsManager.saveSettings(updatedSettings);

    return NextResponse.json({
      success: true,
      data: updatedSettings,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update settings',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // Reset to default settings
    await settingsManager.saveSettings(defaultSettings);

    return NextResponse.json({
      success: true,
      data: defaultSettings,
      message: 'Settings reset to defaults'
    });
  } catch (error) {
    console.error('Error resetting settings:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to reset settings',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}