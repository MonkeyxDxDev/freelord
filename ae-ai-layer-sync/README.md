# AE ⇄ Illustrator Layer Sync

A tool that lets you send layers back and forth between Adobe After Effects
and Adobe Illustrator with the click of a button — shapes, text, colors, and
positions all come across. It adds a small panel to each app; you use the
panel to push your current layers to the other app, or pull the other app's
layers into the one you're in.

You need both apps installed and, for the Illustrator half, a Mac or PC where
you're comfortable running one Terminal/Command Prompt command.

## Step 1: Install the After Effects panel

1. Find the file `AfterEffects/LayerSyncPanel.jsx` in this project.
2. Copy it into After Effects' panel folder:
   `.../After Effects <your version>/Scripts/ScriptUI Panels/`
   (On a Mac this is usually under
   `~/Library/Application Support/Adobe/After Effects <version>/`.)
3. Also copy the file `Common/LayerSyncLib.jsx` into a new folder called
   `Common` that sits right next to `ScriptUI Panels` (same level, not inside
   it). The panel needs this second file to work.
4. Close and reopen After Effects.
5. Go to the **Window** menu at the top and click **LayerSyncPanel.jsx**. A
   small panel should appear — that means it worked.

## Step 2: Install the Illustrator panel

Illustrator needs a slightly different kind of install (called a CEP
extension), which is why the folder for it is named `Illustrator-CEP`.

1. Copy the entire `Illustrator-CEP` folder into:
   - **Mac:** `~/Library/Application Support/Adobe/CEP/extensions/com.layersync.illustrator/`
   - **Windows:** `%AppData%\Adobe\CEP\extensions\com.layersync.illustrator\`
   (If the `CEP/extensions` folder doesn't exist yet, create it.)
2. This extension isn't officially signed by Adobe, so you need to tell your
   computer it's okay to run it. On a Mac, open the **Terminal** app and
   paste in each of these lines, pressing Enter after each one:
   ```
   defaults write com.adobe.CSXS.9 PlayerDebugMode 1
   defaults write com.adobe.CSXS.10 PlayerDebugMode 1
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   defaults write com.adobe.CSXS.12 PlayerDebugMode 1
   ```
   On Windows, this is a Registry setting instead — search for
   `HKEY_CURRENT_USER\Software\Adobe\CSXS.<version>` and add a value named
   `PlayerDebugMode` set to `1` for each version number you find there.
3. Close and reopen Illustrator.
4. Go to **Window → Extensions → LayerSync**. A panel should appear on the
   right side of the screen.

**A note for Mac users:** the After Effects folder in Step 1 lives inside
your Applications folder, which your Mac protects — copying into it may ask
for your password (via `sudo` in Terminal, if you're doing it that way).
That's normal and expected.

## Step 3: Use it

1. Open a project in After Effects and a document in Illustrator, with both
   panels open (from Steps 1 and 2).
2. In either panel, click **Test Connection** first — this just confirms the
   two apps can talk to each other. If it fails, make sure both apps are
   open and both panels are visible.
3. Click **Push** to send your current layers to the other app, or **Pull**
   to bring the other app's layers into the one you're looking at.

That's it — whichever app you're working in, Push sends your changes over,
Pull brings the other side's changes in.
