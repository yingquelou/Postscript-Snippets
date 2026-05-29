export function containsBinaryData(text: string): boolean {
  if (!text) return false
  
  const SAMPLE_SIZE = 4096
  const checkLength = Math.min(text.length, SAMPLE_SIZE)
  
  let controlCharCount = 0
  let invalidUtf8Count = 0
  
  for (let i = 0; i < checkLength; i++) {
    const charCode = text.charCodeAt(i)
    
    if (charCode === 0) {
      return true
    } else if (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) {
      controlCharCount++
    } else if (charCode > 127) {
      if (!isValidUtf16Surrogate(charCode)) {
        invalidUtf8Count++
      }
    }
    
    if (i > 0 && i % 128 === 0) {
      const currentRatio = controlCharCount / (i + 1)
      if (currentRatio > 0.1) {
        return true
      }
      const invalidUtf8Ratio = invalidUtf8Count / (i + 1)
      if (invalidUtf8Ratio > 0.1) {
        return true
      }
    }
  }
  
  const controlRatio = controlCharCount / checkLength
  if (controlRatio > 0.1) {
    return true
  }
  
  const invalidUtf8Ratio = invalidUtf8Count / checkLength
  if (invalidUtf8Ratio > 0.1) {
    return true
  }
  
  if (!isValidUtf8(text)) {
    return true
  }
  
  return false
}

function isValidUtf16Surrogate(charCode: number): boolean {
  if (charCode >= 0xD800 && charCode <= 0xDFFF) {
    return false
  }
  return charCode <= 0xFFFF
}

function isValidUtf8(text: string): boolean {
  try {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    const decoder = new TextDecoder('utf-8', { fatal: true })
    decoder.decode(bytes)
    return true
  } catch {
    return false
  }
}