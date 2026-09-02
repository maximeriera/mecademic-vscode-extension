'use strict';

// The only module allowed to touch the VS Code API. Everything it does here is
// wiring: it converts settings into plain options, calls the pure modules, and
// turns their plain objects into editor types. No validation logic lives here.

const vscode = require('vscode');

const { loadInstructionSet, findInstruction, buildSignature, buildParameterLabels, buildDocumentation } =
  require('./instructions');
const { parseLine, analyzeDocument } = require('./analyze');

const LANGUAGE = 'mxprog';

const SEVERITIES = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning
};

let instructionSet;

function readOptions() {
  const config = vscode.workspace.getConfiguration('mecademic');
  return {
    enable: config.get('diagnostics.enable', true),
    unknownInstruction: config.get('diagnostics.unknownInstruction', 'warning'),
    rangeChecks: config.get('diagnostics.rangeChecks', true)
  };
}

function toDiagnostic(issue) {
  const range = new vscode.Range(issue.line, issue.start, issue.line, issue.end);
  const diagnostic = new vscode.Diagnostic(range, issue.message, SEVERITIES[issue.severity]);
  diagnostic.source = 'mxprog';
  diagnostic.code = issue.code;
  return diagnostic;
}

function refreshDiagnostics(document, collection) {
  if (document.languageId !== LANGUAGE) {
    return;
  }

  const options = readOptions();
  if (!options.enable) {
    collection.delete(document.uri);
    return;
  }

  const issues = analyzeDocument(document.getText(), instructionSet, options);
  collection.set(document.uri, issues.map(toDiagnostic));
}

function markdown(instruction) {
  const value = new vscode.MarkdownString(buildDocumentation(instruction));
  value.supportHtml = false;
  return value;
}

const hoverProvider = {
  provideHover(document, position) {
    const parsed = parseLine(document.lineAt(position.line).text);
    if (parsed.kind !== 'call') {
      return null;
    }
    if (position.character < parsed.nameStart || position.character > parsed.nameEnd) {
      return null;
    }

    const instruction = findInstruction(instructionSet, parsed.name);
    if (!instruction) {
      return null;
    }

    const range = new vscode.Range(position.line, parsed.nameStart, position.line, parsed.nameEnd);
    return new vscode.Hover(markdown(instruction), range);
  }
};

const completionProvider = {
  provideCompletionItems() {
    return instructionSet.instructions.map((instruction) => {
      const item = new vscode.CompletionItem(instruction.name, vscode.CompletionItemKind.Function);
      item.detail = buildSignature(instruction);
      item.documentation = markdown(instruction);
      item.insertText = new vscode.SnippetString(`${instruction.name}($0)`);
      item.filterText = instruction.name;
      return item;
    });
  }
};

/** Which argument the cursor sits in, or -1 when it is not inside the parentheses. */
function activeParameter(parsed, character) {
  if (!parsed.args.length) {
    return 0;
  }
  for (let i = 0; i < parsed.args.length; i += 1) {
    if (character <= parsed.args[i].end) {
      return i;
    }
  }
  return parsed.args.length - 1;
}

const signatureProvider = {
  provideSignatureHelp(document, position) {
    const parsed = parseLine(document.lineAt(position.line).text);
    if (parsed.kind !== 'call' || position.character <= parsed.nameEnd) {
      return null;
    }

    const instruction = findInstruction(instructionSet, parsed.name);
    if (!instruction) {
      return null;
    }

    const signature = new vscode.SignatureInformation(buildSignature(instruction), markdown(instruction));
    signature.parameters = buildParameterLabels(instruction).map(
      (label, index) => new vscode.ParameterInformation(label, instruction.params[index].description)
    );

    const help = new vscode.SignatureHelp();
    help.signatures = [signature];
    help.activeSignature = 0;
    help.activeParameter = Math.min(activeParameter(parsed, position.character), Math.max(instruction.params.length - 1, 0));
    return help;
  }
};

function activate(context) {
  instructionSet = loadInstructionSet();

  const diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE);
  const selector = { language: LANGUAGE, scheme: 'file' };

  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerHoverProvider(selector, hoverProvider),
    vscode.languages.registerCompletionItemProvider(selector, completionProvider),
    vscode.languages.registerSignatureHelpProvider(selector, signatureProvider, '(', ','),
    vscode.workspace.onDidOpenTextDocument((document) => refreshDiagnostics(document, diagnostics)),
    vscode.workspace.onDidChangeTextDocument((event) => refreshDiagnostics(event.document, diagnostics)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('mecademic')) {
        return;
      }
      for (const document of vscode.workspace.textDocuments) {
        refreshDiagnostics(document, diagnostics);
      }
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    refreshDiagnostics(document, diagnostics);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
