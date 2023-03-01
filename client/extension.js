import * as path from 'path';
import { workspace as Workspace, window as Window, Uri } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js';
let defaultClient;
const clients = new Map();
let _sortedWorkspaceFolders;
function sortedWorkspaceFolders() {
    if (_sortedWorkspaceFolders === void 0) {
        _sortedWorkspaceFolders = Workspace.workspaceFolders ? Workspace.workspaceFolders.map(folder => {
            let result = folder.uri.toString();
            if (result.charAt(result.length - 1) !== '/') {
                result = result + '/';
            }
            return result;
        }).sort((a, b) => {
            return a.length - b.length;
        }) : [];
    }
    return _sortedWorkspaceFolders;
}
Workspace.onDidChangeWorkspaceFolders(() => _sortedWorkspaceFolders = undefined);
function getOuterMostWorkspaceFolder(folder) {
    const sorted = sortedWorkspaceFolders();
    for (const element of sorted) {
        let uri = folder.uri.toString();
        if (uri.charAt(uri.length - 1) !== '/') {
            uri = uri + '/';
        }
        if (uri.startsWith(element)) {
            return Workspace.getWorkspaceFolder(Uri.parse(element));
        }
    }
    return folder;
}
export function activate(context) {
    const module = context.asAbsolutePath(path.join('prelect/lsp', 'prelect-lsp-server.js'));
    const outputChannel = Window.createOutputChannel('prelectClient');
    function didOpenTextDocument(document) {
        // We are only interested in language mode text
        if (document.languageId !== 'prelect' || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled')) {
            return;
        }
        const uri = document.uri;
        // Untitled files go to a default client.
        if (uri.scheme === 'untitled' && !defaultClient) {
            const serverOptions = {
                run: { module, transport: TransportKind.ipc },
                debug: { module, transport: TransportKind.ipc }
            };
            const clientOptions = {
                documentSelector: [
                    { scheme: 'untitled', language: 'prelect' }
                ],
                diagnosticCollectionName: 'prelectClient',
                outputChannel: outputChannel
            };
            defaultClient = new LanguageClient('prelectClient', 'PRELECT LSP Client', serverOptions, clientOptions);
            defaultClient.start();
            return;
        }
        let folder = Workspace.getWorkspaceFolder(uri);
        // Files outside a folder can't be handled. This might depend on the language.
        // Single file languages like JSON might handle files outside the workspace folders.
        if (!folder) {
            return;
        }
        // If we have nested workspace folders we only start a server on the outer most workspace folder.
        folder = getOuterMostWorkspaceFolder(folder);
        if (!clients.has(folder.uri.toString())) {
            const serverOptions = {
                run: { module, transport: TransportKind.ipc },
                debug: { module, transport: TransportKind.ipc }
            };
            const clientOptions = {
                documentSelector: [
                    { scheme: 'file', language: 'prelect', pattern: `${folder.uri.fsPath}/**/*` }
                ],
                diagnosticCollectionName: 'prelectClient',
                workspaceFolder: folder,
                outputChannel: outputChannel
            };
            const client = new LanguageClient('prelectClient', 'PRELECT LSP Client', serverOptions, clientOptions);
            client.start();
            clients.set(folder.uri.toString(), client);
        }
    }
    Workspace.onDidOpenTextDocument(didOpenTextDocument);
    Workspace.textDocuments.forEach(didOpenTextDocument);
    Workspace.onDidChangeWorkspaceFolders((event) => {
        for (const folder of event.removed) {
            const client = clients.get(folder.uri.toString());
            if (client) {
                clients.delete(folder.uri.toString());
                client.stop();
            }
        }
    });
}
export function deactivate() {
    const promises = [];
    if (defaultClient) {
        promises.push(defaultClient.stop());
    }
    for (const client of clients.values()) {
        promises.push(client.stop());
    }
    return Promise.all(promises).then(() => undefined);
}