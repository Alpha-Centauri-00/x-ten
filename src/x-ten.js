// ============================================================================
// FILE: xl_extension/src/extension.js
// Hover over variable names to see element screenshots
// ============================================================================

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
  console.log('✅ XL Extension activated!');

  const hoverProvider = vscode.languages.registerHoverProvider(
    ['python', 'javascript', 'typescript'],
    new ElementHoverProvider()
  );

  context.subscriptions.push(hoverProvider);
}

class ElementHoverProvider {
  constructor() {
    // Cache metadata to avoid repeated file reads
    this.metadataCache = null;
    this.metadataCachePath = null;
    this.lastCacheTime = 0;
    this.cacheTimeout = 5000; // 5 seconds
  }

  // Load metadata from file with caching
  loadMetadata(metadataFile) {
    const now = Date.now();

    // Return cached metadata if still fresh
    if (this.metadataCache && 
        this.metadataCachePath === metadataFile && 
        now - this.lastCacheTime < this.cacheTimeout) {
      return this.metadataCache;
    }

    // Load from disk
    if (!fs.existsSync(metadataFile)) {
      return null;
    }

    try {
      const rawMetadata = fs.readFileSync(metadataFile, 'utf8');
      const metadata = JSON.parse(rawMetadata);

      // Cache it
      this.metadataCache = metadata;
      this.metadataCachePath = metadataFile;
      this.lastCacheTime = now;

      return metadata;
    } catch (error) {
      console.error('Error loading metadata:', error);
      return null;
    }
  }

  // Get variable name at cursor position
  getVariableAtPosition(document, position) {
    // Get the word at cursor position
    const range = document.getWordRangeAtPosition(position);
    if (!range) return null;

    const word = document.getText(range);

    // Check if it's a valid variable name (alphanumeric, underscore)
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(word)) {
      return null;
    }

    return word;
  }

  // Extract the value assigned to a variable
  extractVariableValue(line, variableName) {
    // Extract the value assigned to a variable from a line
    // Handles: var = "value" or var = 'value' or var = `value`
    
    // Create regex to find: variableName = "..." or variableName = '...' or variableName = `...`
    const doubleQuoteRegex = new RegExp(`${variableName}\\s*=\\s*"([^"]*)"`);
    const singleQuoteRegex = new RegExp(`${variableName}\\s*=\\s*'([^']*)'`);
    const backQuoteRegex = new RegExp(`${variableName}\\s*=\\s*\\\`([^\\\`]*)\\\``);

    let match = line.match(doubleQuoteRegex);
    if (match && match[1]) return match[1];

    match = line.match(singleQuoteRegex);
    if (match && match[1]) return match[1];

    match = line.match(backQuoteRegex);
    if (match && match[1]) return match[1];

    return null;
  }

  // Find variable assignment in the entire document
  findVariableAssignment(document, variableName) {
    try {
      // Search backwards from current position through the document
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const value = this.extractVariableValue(line, variableName);
        if (value) {
          return value;
        }
      }
    } catch (error) {
      // Silently fail if document access fails
    }
    return null;
  }

  // Main hover provider
  provideHover(document, position, token) {
    try {
      // Get the variable name at cursor
      const variableName = this.getVariableAtPosition(document, position);
      if (!variableName) {
        return null;
      }

      // Try to find screenshot for this variable
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return null;
      }

      const photosDir = path.join(workspaceFolder.uri.fsPath, '.photos');
      const metadataFile = path.join(photosDir, 'element_selectors.json');

      if (!fs.existsSync(metadataFile)) {
        return null;
      }

      // Load metadata (with caching)
      const metadata = this.loadMetadata(metadataFile);
      if (!metadata) {
        return null;
      }

      // Look up variable name in metadata
      const element = metadata[variableName];
      if (!element) {
        return null;
      }

      // Validate that the variable's actual value matches the metadata
      // First, try to find the assignment on the current line
      const line = document.lineAt(position.line).text;
      let actualValue = this.extractVariableValue(line, variableName);
      
      // If not on current line, search the entire document
      if (!actualValue) {
        actualValue = this.findVariableAssignment(document, variableName);
      }
      
      // Only show photo if we found a matching value
      if (!actualValue) {
        return null; // Can't verify the value, don't show photo
      }

      // Check if the actual value matches xpath or css in metadata
      const hasMatchingValue = 
        (element.xpath && element.xpath === actualValue) ||
        (element.css && element.css === actualValue);
      
      if (!hasMatchingValue) {
        return null; // Value doesn't match, don't show photo
      }

      // Photo file exists?
      const photoPath = path.join(photosDir, element.photo);
      if (!fs.existsSync(photoPath)) {
        return null;
      }

      // Create hover content
      const imageUri = vscode.Uri.file(photoPath);
      const imageUriString = imageUri.toString();

      const markdown = new vscode.MarkdownString();
      // markdown.appendMarkdown(`![Element](${imageUriString})\n\n`);
      markdown.appendMarkdown(`![Element](${imageUriString}|width=400)\n\n`);
      markdown.appendMarkdown(`**Tag**: \`${element.tag}\`\n\n`);

      if (element.text) {
        markdown.appendMarkdown(`**Text**: ${element.text}\n\n`);
      }

      if (element.xpath) {
        markdown.appendMarkdown(`**XPath**: \`\`\`\n${element.xpath}\n\`\`\`\n\n`);
      }

      if (element.css) {
        markdown.appendMarkdown(`**CSS**: \`\`\`\n${element.css}\n\`\`\`\n`);
      }

      markdown.isTrusted = true;

      return new vscode.Hover(markdown);

    } catch (error) {
      console.error('Error in hover provider:', error);
      return null;
    }
  }
}

function deactivate() {
  console.log('XL Extension deactivated');
}

module.exports = {
  activate,
  deactivate
};
