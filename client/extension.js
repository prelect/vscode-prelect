const path = require("path");
const vscode = require("vscode");
const node = require("vscode-languageclient/node");

let defaultClient;
const clients = new Map();
let sortedWorkspaceFolders;
function getSortedWorkspaceFolders() {
  if (!sortedWorkspaceFolders) {
    sortedWorkspaceFolders = vscode.workspace.workspaceFolders
      ? vscode.workspace.workspaceFolders
          .map((folder) => {
            let result = folder.uri.toString();
            if (result.charAt(result.length - 1) !== "/") {
              result += "/";
            }
            return result;
          })
          .sort((a, b) => a.length - b.length)
      : [];
  }
  return sortedWorkspaceFolders;
}

vscode.workspace.onDidChangeWorkspaceFolders(() => {
  sortedWorkspaceFolders = undefined;
  return sortedWorkspaceFolders;
});

function getOuterMostWorkspaceFolder(folder) {
  const sorted = getSortedWorkspaceFolders();

  sorted.forEach((element) => {
    let uri = folder.uri.toString();
    if (uri.charAt(uri.length - 1) !== "/") {
      uri += "/";
    }
    if (uri.startsWith(element)) {
      return vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(element));
    }

    return null;
  });

  return folder;
}

function activate(context) {
  const module = context.asAbsolutePath(
    path.join("prelect", "lsp", "prelect-lsp-server.js")
  );
  const outputChannel = vscode.window.createOutputChannel("prelectClient");
  function didOpenTextDocument(document) {
    // We are only interested in language mode text
    if (
      document.languageId !== "prelect" ||
      (document.uri.scheme !== "file" && document.uri.scheme !== "untitled")
    ) {
      return;
    }
    const { uri } = document;
    // Untitled files go to a default client.
    if (uri.scheme === "untitled" && !defaultClient) {
      const serverOptions = {
        run: { module, transport: node.TransportKind.ipc },
        debug: { module, transport: node.TransportKind.ipc },
      };
      const clientOptions = {
        documentSelector: [{ scheme: "untitled", language: "prelect" }],
        diagnosticCollectionName: "prelectClient",
        outputChannel,
      };
      defaultClient = new node.LanguageClient(
        "prelectClient",
        "PRELECT LSP Client",
        serverOptions,
        clientOptions
      );
      defaultClient.start();
      return;
    }
    let folder = vscode.workspace.getWorkspaceFolder(uri);
    // Files outside a folder can't be handled. This might depend on the language.
    // Single file languages like JSON might handle files outside the workspace folders.
    if (!folder) {
      return;
    }
    // If we have nested workspace folders we only start a server on the outer most workspace folder.
    folder = getOuterMostWorkspaceFolder(folder);
    if (!clients.has(folder.uri.toString())) {
      const serverOptions = {
        run: { module, transport: node.TransportKind.ipc },
        debug: { module, transport: node.TransportKind.ipc },
      };
      const clientOptions = {
        documentSelector: [
          {
            scheme: "file",
            language: "prelect",
            pattern: `${folder.uri.fsPath}/**/*`,
          },
        ],
        diagnosticCollectionName: "prelectClient",
        workspaceFolder: folder,
        outputChannel,
      };
      const client = new node.LanguageClient(
        "prelectClient",
        "PRELECT LSP Client",
        serverOptions,
        clientOptions
      );
      client.start();
      clients.set(folder.uri.toString(), client);
    }
  }
  vscode.workspace.onDidOpenTextDocument(didOpenTextDocument);
  vscode.workspace.textDocuments.forEach(didOpenTextDocument);
  vscode.workspace.onDidChangeWorkspaceFolders((event) => {
    event.removed.forEach((folder) => {
      const client = clients.get(folder.uri.toString());
      if (client) {
        clients.delete(folder.uri.toString());
        client.stop();
      }
    });
  });
}

async function deactivate() {
  const promises = [];
  if (defaultClient) {
    promises.push(defaultClient.stop());
  }

  clients.values().forEach((client) => promises.push(client.stop()));

  return Promise.all(promises);
}

module.exports.activate = activate;
module.exports.deactivate = deactivate;
