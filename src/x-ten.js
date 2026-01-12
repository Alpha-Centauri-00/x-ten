// ============================================================================
// Hover over variable names to see element screenshots
// Support for Python, JavaScript, TypeScript, and Robot Framework
// ============================================================================

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
  console.log('XL Extension activated!');

  const hoverProvider = vscode.languages.registerHoverProvider(
    ['python', 'javascript', 'typescript', 'robotframework'],
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
    this.cacheTimeout = 5000;
    
    // Cache variable assignments to avoid rescanning
    this.variableAssignmentCache = {};
    this.variableAssignmentCachePath = null;
    this.variableAssignmentCacheTime = 0;
    this.variableAssignmentCacheTimeout = 5000;
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
    const line = document.lineAt(position.line).text;
    const character = position.character;

    // detect ${VARIABLE} syntax
    if (document.languageId === 'robotframework') {
      // Check if cursor is inside ${}
      const robotVarRegex = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
      let match;
      
      while ((match = robotVarRegex.exec(line)) !== null) {
        const varStart = match.index;
        const varEnd = match.index + match[0].length;
        
        // Check if cursor is within this variable
        if (character >= varStart && character <= varEnd) {
          return match[1]; // Return just the variable name without ${}
        }
      }
      return null;
    }

    // For Python, JavaScript, TypeScript: use word boundary detection
    const range = document.getWordRangeAtPosition(position);
    if (!range) return null;

    const word = document.getText(range);

    // Check if it's a valid variable name (alphanumeric, underscore)
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(word)) {
      return null;
    }

    return word;
  }

  // Extract the value assigned to a variable (Python/JS/TS style)
  extractVariableValue(line, variableName) {
    // Handles: var = "value" or var = 'value' or var = `value`
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

  // Extract Robot Framework variable value
  // Handles: ${VAR_NAME}    //xpath or ${VAR_NAME}    .css-selector
  extractRobotVariableValue(line, variableName) {
    const robotVarRegex = new RegExp(`\\$\\{${variableName}\\}\\s+(.+?)$`);
    
    const match = line.match(robotVarRegex);
    if (match && match[1]) {
      return match[1].trim();
    }

    return null;
  }

  // Build variable assignment cache for better performance on large files
  buildVariableAssignmentCache(document) {
    const now = Date.now();
    
    // Return cached results if still fresh
    if (this.variableAssignmentCache && 
        this.variableAssignmentCachePath === document.uri.fsPath && 
        now - this.variableAssignmentCacheTime < this.variableAssignmentCacheTimeout) {
      return this.variableAssignmentCache;
    }

    // Build cache by scanning document once
    this.variableAssignmentCache = {};
    const isRobot = document.languageId === 'robotframework';

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;
      
      if (isRobot) {
        // Robot Framework: find all ${VAR} definitions
        const varRegex = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
        let match;
        while ((match = varRegex.exec(line)) !== null) {
          const varName = match[1];
          // Only process if we haven't found this variable yet
          if (!this.variableAssignmentCache[varName]) {
            const value = this.extractRobotVariableValue(line, varName);
            if (value) {
              this.variableAssignmentCache[varName] = value;
            }
          }
        }
      } else {
        // Python/JS/TS: find all variable assignments
        const assignmentRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;
        let match;
        while ((match = assignmentRegex.exec(line)) !== null) {
          const varName = match[1];
          // Only process if we haven't found this variable yet
          if (!this.variableAssignmentCache[varName]) {
            const value = this.extractVariableValue(line, varName);
            if (value) {
              this.variableAssignmentCache[varName] = value;
            }
          }
        }
      }
    }

    // Cache the results
    this.variableAssignmentCachePath = document.uri.fsPath;
    this.variableAssignmentCacheTime = now;

    return this.variableAssignmentCache;
  }

  // Find variable assignment efficiently using cache
  findVariableAssignmentEfficient(document, variableName) {
    const cache = this.buildVariableAssignmentCache(document);
    return cache[variableName] || null;
  }

  // Main hover provider
  provideHover(document, position, token) {
    try {
      // Get the variable name at cursor
      const variableName = this.getVariableAtPosition(document, position);
      if (!variableName) {
        return null;
      }

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
      // Use efficient cache-based lookup
      const actualValue = this.findVariableAssignmentEfficient(document, variableName);
      
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
