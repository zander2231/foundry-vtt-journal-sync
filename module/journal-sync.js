"use strict";
import * as Constants from "./constants.js"
import * as Logger from './logger.js'

let markdownPathOptions, markdownSourcePath, journalEditorLink, importWorldPath, exportWorldPath;
let enableTracing = false;
let newImportedFiles = "";
let skippedJournalFolders, skippedJournalEntries;
let FilePicker = foundry.applications.apps.FilePicker.implementation

// parses the string back to something the FilePicker can understand as an option
export function parse(str) {
  let matches = str.match(/\[(.+)\]\s*(.+)/);
  if (matches) {
    let source = matches[1];
    const current = matches[2].trim();
    const [s3, bucket] = source.split(":");
    if (bucket !== undefined) {
      return {
        activeSource: s3,
        bucket: bucket,
        current: current,
      };
    } else {
      return {
        activeSource: s3,
        bucket: null,
        current: current,
      };
    }
  }
  // failsave, try it at least
  return {
    activeSource: "data",
    bucket: null,
    current: str,
  };
}

export async function fetchParams(silent = false) {
    markdownPathOptions = parse(game.settings.get(Constants.MODULE_NAME, "MarkdownSourcePath"));
    markdownSourcePath = markdownPathOptions.current;

    journalEditorLink = game.settings.get(Constants.MODULE_NAME, "JournalEditorLink");
    enableTracing = game.settings.get(Constants.MODULE_NAME, "EnableTracing");
    
    importWorldPath = game.settings.get(Constants.MODULE_NAME, "ImportWorldPath");
    exportWorldPath = game.settings.get(Constants.MODULE_NAME, "ExportWorldPath");

    skippedJournalFolders = game.settings.get(Constants.MODULE_NAME, "SkipJournalFolders").split(',');
    skippedJournalEntries = game.settings.get(Constants.MODULE_NAME, "SkipJournalEntries").split(',');

    // If the entries are empty it will set the array to one empty string ""
    // This matches the root path where the folder name is also 
    // "" so blocked export/import. If nothing set put a name in that no
    // one in their right mind would use :)
    if(skippedJournalFolders.length == 1 && skippedJournalFolders[0] === "") {
        skippedJournalFolders[0] = "NOTHINGHASBEENSETTOSKIP";
    }
    if(skippedJournalEntries.length == 1 && skippedJournalEntries[0] === "") {
        skippedJournalEntries[0] = "NOTHINGHASBEENSETTOSKIP";
    }
}

/**
 * Runs during the init hook of Foundry
 *
 * During init the settings and trace logging is set.
 *
 */
export async function initModule() {
    Logger.log("Init Module entered")
    await fetchParams(true);
    if (enableTracing) {
        Logger.enableTracing();
    }

    Hooks.on("chatCommandsReady", (chatCommands) => {
        chatCommands.register(
            {
                name: "/js", // The slash command name (e.g., /mycommand)
                module: "journal-sync", // Your module's ID
                description: "Sync journal entries to convienient markdown format.",
                callback: async (chatlog, messageText, chatdata) => {
                    // This function is executed when the command is used
                    // 'messageText' will contain any arguments after the command
                    // 'chatdata' contains information about the chat message
                    switch (messageText) {
                        case "help":
                            return {
                                content: "HERE IS HELP!",
                            };
                        case "test": // /js test
                            // FilePicker.browse(markdownPathOptions.activeSource, "/").then((result) => {
                            //     ChatMessage.create({content: JSON.stringify(result)});
                            //     Logger.log(markdownPathOptions.activeSource)
                            // });

                            game.journal.forEach((value, key) => {
                                Logger.log(`${value.name} = f:${value.folder}`);
                                value.pages.forEach((page, pkey) => {
                                    Logger.log(`   p[${page.name} = ${page.text.content}]`);
                                });
                            });
                            return {};
                        case "export": // /js export
                            await startExport();
                            return {};
                        case "import": // /js import
                            await startImport();
                            return {};
                        case "nukejournals":
                            game.journal.forEach((value, key, map) => { JournalEntry.delete(value.id); });
                            return {};
                        case "nukefolders":
                            game.journal.forEach((value, key, map) => { JournalEntry.delete(value.id); });
                            return {};
                        default:
                            return {
                                content: "HERE IS HELP!",
                            };
                    }
                },
                shouldDisplayToChat: false, // Whether the command should be displayed in the chat log
                //icon: "fas fa-dice-d20", // Optional icon for the command
                // You can add more options like `autocomplete`, `aliases`, etc.
            }
        );
    });
}

export async function readyModule() {
    Logger.log("Ready Module entered")
    await fetchParams();

    Logger.log(`markdownSourcePath: ${markdownSourcePath}`)
    Logger.log(`validMarkdownSourcePath(): ${await validMarkdownSourcePath()}`)

    // Create markdownSourcePath if not already there.
    let buildPath = '';
    validMarkdownSourcePath().split('/').forEach((path) => {
        buildPath += path + '/';
        FilePicker.createDirectory(markdownPathOptions.activeSource, buildPath)
            .then((result) => {
                Logger.log(`Creating ${buildPath}`);
            })
            .catch((error) => {
                if (!error.message.includes("EEXIST")) {
                    Logger.log(error.message);
                }
            });
    });

    Hooks.on("getSceneControlButtons", (controls) => {
        let group = controls.find(b => b.name == "notes")
        group.tools.push({
            name: "import",
            title: "Import Journals",
            icon: "fas fa-file-import",
            onClick: () => {
                startImport();
            },
            button: true
        });
        group.tools.push({
            name: "export",
            title: "Export Journals",
            icon: "fas fa-file-export",
            onClick: () => {
                startExport();
            },
            button: true,
        });

        if (journalEditorLink != "") {
            group.tools.push({
                name: "edit",
                title: "Edit Journals",
                icon: "fas fa-edit",
                onClick: () => {
                    window.open(journalEditorLink, "_blank");
                },
                button: true,
            });
        }
    });
}

async function startImport() {
    // await createJournalFolders(validMarkdownSourcePath()+validImportWorldPath(), null);
    // let result = await FilePicker.browse(markdownPathOptions.activeSource, validMarkdownSourcePath()+validImportWorldPath());
    // for (let [key, file] of Object.entries(result.files)) {
    //     if(isValidFile(file)) {
    //         await importFile(file);
    //     }
    // }
    // for (let [key, folder] of Object.entries(result.dirs)) {
    //     await importFolder(folder);
    // }

    let parentPath = validMarkdownSourcePath()+validExportWorldPath();
    await importFolder(parentPath+"/root");
    // ui.notifications.info("Import completed");
}

async function startExport() {
    let parentPath = validMarkdownSourcePath()+validExportWorldPath();
    await FilePicker.createDirectory(markdownPathOptions.activeSource, parentPath)
        .then((result) => {
            Logger.log(`Created ${parentPath}`);
        })
        .catch((error) => {
            Logger.log(error.message);
        });

    exportFolder(game.journal.tree, parentPath+"/root");
}

function validMarkdownSourcePath() {
    let validMarkdownSourcePath = markdownSourcePath.replace("\\", "/");
    validMarkdownSourcePath += validMarkdownSourcePath.endsWith("/") ? "" : "/";
    return validMarkdownSourcePath;
}

function validImportWorldPath() {
    let validImportWorldPath = importWorldPath == "" ? (game.world.id + "/") : importWorldPath;
    validImportWorldPath += validImportWorldPath.endsWith("/") ? "" : "/";
    return validImportWorldPath;
}

function validExportWorldPath() {
    let validExportWorldPath = exportWorldPath == "" ? (game.world.id + "/") : exportWorldPath;
    validExportWorldPath += validExportWorldPath.endsWith("/") ? "" : "/";
    return validExportWorldPath;
}

function isValidFile(filename) {
    return filename.endsWith('.md');
}

function isValidFileName(filename) {
    var re = /^(?!\.)(?!com[0-9]$)(?!con$)(?!lpt[0-9]$)(?!nul$)(?!prn$)[^\|\*\?\\:<>/$"]*[^\.\|\*\?\\:<>/$"]+$/
    return re.test(filename);
}

function generateJournalFileName(journalEntity) {
    return `${journalEntity.name.replace(" ","-")}(${journalEntity.id}).md`
}

function getJournalIdFromFilename(fileName) {
    return last(fileName.split('(')).replace(').md', '');
}

function getJournalPageNameFromFilename(fileName) {
    return fileName.replace(`(${getJournalIdFromFilename(fileName)})`, '').replace('.md', '').replace("-"," ");
}

function last(array) {
    return array[array.length - 1];
}

function hasJsonStructure(str) {
    if (typeof str !== 'string') return false;
    try {
        const result = JSON.parse(str);
        const type = Object.prototype.toString.call(result);
        return type === '[object Object]'
            || type === '[object Array]';
    } catch (err) {
        return false;
    }
}

async function importFolder(importFolderPath) {
    Logger.logTrace(`Importing folder: ${importFolderPath}`);
    let result = await FilePicker.browse(markdownPathOptions.activeSource, importFolderPath);

    for (let [key, file] of Object.entries(result.files)) {
        if(isValidFile(file)) {
            await importFile(file);
        }
    }

    for (let [key, folder] of Object.entries(result.dirs)) {
        await importFolder(folder);
    }
}

// This will create the journal folder in FVTT
// async function createJournalFolders(rootPath, parentFolderId) {
//     Logger.logTrace(`createJournalFolders | Params(folder = ${rootPath} parent = ${parentFolderId})`)
//     let result = await FilePicker.browse(markdownPathOptions.activeSource, rootPath)
//     for (let [key, folder] of Object.entries(result.dirs)) {
//         let thisFolderName = last(decodeURIComponent(folder).split('/'));
//         let folderDetails = game.folders.filter(f => (f.type === "JournalEntry") && (f.name === thisFolderName) && (f.parent === parentFolderId));

//         if (folderDetails.length == 0) {
//             Logger.logTrace(`createJournalFolders | Creating folder path: ${thisFolderName} parent: ${parentFolderId}`)
//             Logger.logTrace(`${JSON.stringify({ name: thisFolderName, type: "JournalEntry", parent: parentFolderId })}`);
//             await Folder.create({ name: thisFolderName, type: "JournalEntry", parent: parentFolderId });
//         }

//         folderDetails = game.folders.filter(f => (f.type === "JournalEntry") && (f.name === thisFolderName) && (f.parent === parentFolderId));
//         Logger.logTrace(`createJournalFolders | folder: ${folder} thisFolderName: ${thisFolderName} folderDetails._id: ${folderDetails[0]?._id} folderDetails: ${JSON.stringify(folderDetails)}`)

//         createJournalFolders(folder, folderDetails[0]._id);
//     }
// }

async function importFile(file) {
    Logger.logTrace(`importFile | params(file = ${file})`);
    var journalPath = decodeURIComponent(file).replace(validMarkdownSourcePath()+validImportWorldPath(), '').trim();
    var pathUrl = (journalPath.startsWith('https://') ? new URL(journalPath) : '')
    if(pathUrl) {
        var tempPathArray = pathUrl.pathname.split("/");
        journalPath = tempPathArray.slice(2).join("/").replace(/\%20/gi,"-");
    }
    
    // Get the parent folder path and journal name
    var pathParts = journalPath.split('/');
    var fileName = pathParts.pop();
    var journalName = pathParts.pop(); // The journal name is now the parent folder
    var parentPath = pathParts.join('/');

    if (skippedJournalEntries.includes(journalName) || skippedJournalFolders.includes(journalName)) {
        return;
    }

    let currentParent = null;

    if (parentPath != '') {
        let pathArray = parentPath.split('/');
        for (let index = 0; index < pathArray.length; index++) {
            const path = pathArray[index];
            if (path != '') {
                let folder = game.folders.filter(f => (f.type === "JournalEntry") && (f.name === path.replace(/-/g, " ")) && (f.parent === currentParent));
                if (folder.length > 0) {
                    currentParent = folder[0]._id;
                    Logger.logTrace(`currentParent: '${currentParent}' path: '${path}' folder: '${JSON.stringify(folder)}'`);
                }
            }
        }
    }

    // Find or create the journal entry
    let journalEntry = game.journal.find(j => j.name === journalName.replace(/-/g, " "));
    if (!journalEntry) {
        journalEntry = await JournalEntry.create({ 
            name: journalName.replace(/-/g, " "), 
            folder: currentParent,
            pages: []
        });
        Logger.log(`Created journal ${journalName}`);
    }

    if(!pathUrl) file = '/' + file;
    const response = await fetch(file);
    const pageContents = await response.text();
    
    // Create or update the page
    let pageName = getJournalPageNameFromFilename(fileName);
    let pageData = {
        name: pageName,
        type: "text",
        text: { content: "" },
        title: { show: false },
    };

    // If the contents is pure JSON ignore it as it may be used by 
    // a module as configuration storage.
    if (hasJsonStructure(pageContents)) {
        pageData.text.content = pageContents;
    } else {
        var converter = new showdown.Converter({ tables: true, strikethrough: true })
        pageData.text.content = converter.makeHtml(pageContents);
    }

    // Find if page already exists
    let existingPage = journalEntry.pages.find(p => p.name === pageName);
    if (existingPage) {
        if (existingPage.type !== "text") {
            Logger.log(`Skipping import of ${pageName} as it is not a text page`);
            return;
        }
        await journalEntry.updateEmbeddedDocuments("JournalEntryPage", [{
            _id: existingPage._id,
            ...pageData
        }]);
        Logger.log(`Updated page ${pageName} in journal ${journalName}`);
    } else {
        await journalEntry.createEmbeddedDocuments("JournalEntryPage", [pageData]);
        Logger.log(`Created page ${pageName} in journal ${journalName}`);
    }
}

async function exportFolder(folder, parentPath) {
    let folderName = folder.folder ? '/'+folder.folder.name:'';
    let folderPath = (parentPath + folderName).replace("//", "/").replace(" ","-").trim();

    await FilePicker.createDirectory(markdownPathOptions.activeSource, folderPath).then(() => {
        Logger.log(`Created ${folderPath}`);
    }).catch((error) => {
        Logger.log(error.message);
    });
  
    for (const journalEntry of folder.entries) {
        exportJournal(journalEntry, folderPath);
    }

    // Recurse for any sub folders. 
    for (const folderEntity of folder.children) {
        exportFolder(folderEntity, folderPath);
    }
}

async function exportJournal(journalEntry, parentPath) {
    if (skippedJournalEntries.includes(journalEntry.name) || skippedJournalFolders.includes(last(parentPath.split('/')))) {
        Logger.log(`Skipping ${journalEntry.name} as it matches exclusion rules`)
        return;
    }

    if(!isValidFileName(journalEntry.name)) {
        ChatMessage.create({ content: `Unable to export:<br /> <strong>${parentPath}/${journalEntry.name}</strong><br />It has invalid character(s) in its name that can not be used in file names.<br /><br /> These characters are invalid: <pre>| * ? \ : < > $</pre><br />Please rename the Journal Entry and export again.` });
    }

    let folderPath = (parentPath + '/' + journalEntry.name).replace("//", "/").replace(" ","-").trim();
    await FilePicker.createDirectory(markdownPathOptions.activeSource, folderPath).then(() => {
        Logger.log(`Created ${folderPath}`);
    }).catch((error) => {
        Logger.log(error.message);
    });

    for (const page of journalEntry.pages) {
        let md = "";
        let pageFileName = generateJournalFileName(page);

        if (page.type !== "text") {
            Logger.log(`Skipping export of ${pageFileName} as it is not a text page`);
            continue;
        }
    
        // If the contents is pure JSON ignore it as it may be used by 
        // a module as configuration storage.
        if (hasJsonStructure(page.text.content)) {
            Logger.log(`Detected JSON, skipping markdown conversion for '${pageFileName}' located at '${parentPath}'`);
            md = page.text.content.content.split('\n');
        } else if (page.text.content) {
            var converter = new showdown.Converter({ tables: true, strikethrough: true });
            md = converter.makeMarkdown(page.text.content).split('\n');
        }
    
        let blob = new Blob([md], {type: "text/markdown"});
        let file = new File([blob], pageFileName, {type: "text/markdown"});
    
        await FilePicker.upload(markdownPathOptions.activeSource, folderPath, file, { bucket: null })
            .then((result) => {
                Logger.log(`Uploaded ${folderPath}/${pageFileName}`);
            })
            .catch((error) => {
                Logger.log(error);
            });        
    }
}
