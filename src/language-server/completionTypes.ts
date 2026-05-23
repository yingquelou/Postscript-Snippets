export interface DictionaryEntry {
  name: string
  type: 'array' | 'boolean' | 'dict' | 'file' | 'fontID' | 'gstate' | 'integer' | 'mark' | 'name' | 'null' | 'operator' | 'packedarray' | 'real' | 'save' | 'string' | 'any'
}

export interface PreloadConfig {
  fileLevel: string[]
  workspaceLevel: string[]
  globalLevel: string[]
  executable?: string
  workingDirectory?: string
  buildArgs?: string[]
}

export interface PreloadConfigValidation {
  isValid: boolean
  errors: string[]
}

export function validatePreloadConfig(config: PreloadConfig): PreloadConfigValidation {
  const errors: string[] = []

  if (!Array.isArray(config.fileLevel)) {
    errors.push('fileLevel must be an array')
  } else {
    config.fileLevel.forEach((path, index) => {
      if (typeof path !== 'string') {
        errors.push(`fileLevel[${index}] must be a string`)
      }
    })
  }

  if (!Array.isArray(config.workspaceLevel)) {
    errors.push('workspaceLevel must be an array')
  } else {
    config.workspaceLevel.forEach((path, index) => {
      if (typeof path !== 'string') {
        errors.push(`workspaceLevel[${index}] must be a string`)
      }
    })
  }

  if (!Array.isArray(config.globalLevel)) {
    errors.push('globalLevel must be an array')
  } else {
    config.globalLevel.forEach((path, index) => {
      if (typeof path !== 'string') {
        errors.push(`globalLevel[${index}] must be a string`)
      }
    })
  }

  if (config.executable !== undefined && typeof config.executable !== 'string') {
    errors.push('executable must be a string')
  }

  if (config.workingDirectory !== undefined && typeof config.workingDirectory !== 'string') {
    errors.push('workingDirectory must be a string')
  }

  if (config.buildArgs !== undefined && !Array.isArray(config.buildArgs)) {
    errors.push('buildArgs must be an array')
  } else if (Array.isArray(config.buildArgs)) {
    config.buildArgs.forEach((arg, index) => {
      if (typeof arg !== 'string') {
        errors.push(`buildArgs[${index}] must be a string`)
      }
    })
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

export interface DictionaryStackInfo {
  entries: DictionaryEntry[]
  stackDepth: number
}