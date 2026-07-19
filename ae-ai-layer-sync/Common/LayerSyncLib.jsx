// LayerSyncLib.jsx
// Shared helpers for the AE <-> Illustrator layer sync panels.
// #include'd by both AfterEffects/LayerSyncPanel.jsx and Illustrator/LayerSyncPanel.jsx.
//
// Wire format is documented in README.md. Canonical convention: center-relative
// to the canvas, Y-down, 1 unit == 1 AE pixel. The AE panel is near-identity;
// all Y-flip / scale conversion lives in the Illustrator panel.

var LS_UNITS_SCALE = 1; // Illustrator points per 1 AE pixel. Tune in both panels if they disagree.
var LS_logTarget = null; // ScriptUI EditText assigned by each panel for on-screen logging.

function LS_setLogTarget(editTextControl) {
    LS_logTarget = editTextControl;
}

function LS_timestamp() {
    var d = new Date();
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function LS_log(msg) {
    var line = "[" + LS_timestamp() + "] " + msg;
    try { $.writeln(line); } catch (e) {}
    if (LS_logTarget) {
        try {
            LS_logTarget.text = LS_logTarget.text + (LS_logTarget.text ? "\n" : "") + line;
            // Keep the log from growing unbounded in the panel.
            var lines = LS_logTarget.text.split("\n");
            if (lines.length > 200) LS_logTarget.text = lines.slice(lines.length - 200).join("\n");
        } catch (e2) {}
    }
    LS_writeLogFile(line);
}

function LS_writeLogFile(line) {
    try {
        var folder = new Folder(Folder.userData.fsName + "/LayerSync");
        if (!folder.exists) folder.create();
        var f = new File(folder.fsName + "/log.txt");
        f.open("a");
        f.writeln(line);
        f.close();
    } catch (e) {
        // Debug logging must never break a sync; swallow silently.
    }
}

// ---- Small math / array helpers -------------------------------------------------

function LS_round2(n) {
    return Math.round(n * 100) / 100;
}

function LS_clamp01(n) {
    return Math.max(0, Math.min(1, n));
}

// ---- Color conversion -------------------------------------------------------------
// AE color values are plain [r,g,b] or [r,g,b,a] arrays normalized 0-1.
// Illustrator color values are SolidColor objects (RGBColor/CMYKColor/GrayColor)
// with channels 0-255 (RGB) or 0-100 (CMYK/Gray/tint).

function LS_aiColorToRGB01(c) {
    if (!c) return null;
    try {
        if (c.typename === "RGBColor") {
            return [LS_clamp01(c.red / 255), LS_clamp01(c.green / 255), LS_clamp01(c.blue / 255)];
        }
        if (c.typename === "CMYKColor") {
            var r = 255 * (1 - c.cyan / 100) * (1 - c.black / 100);
            var g = 255 * (1 - c.magenta / 100) * (1 - c.black / 100);
            var b = 255 * (1 - c.yellow / 100) * (1 - c.black / 100);
            return [LS_clamp01(r / 255), LS_clamp01(g / 255), LS_clamp01(b / 255)];
        }
        if (c.typename === "GrayColor") {
            var g2 = 1 - c.gray / 100;
            return [LS_clamp01(g2), LS_clamp01(g2), LS_clamp01(g2)];
        }
    } catch (e) {
        LS_log("Color read failed: " + e);
    }
    return null; // spot colors / patterns / gradients are not supported
}

function LS_rgb01ToAIColor(rgb) {
    var c = new RGBColor();
    c.red = Math.round(LS_clamp01(rgb[0]) * 255);
    c.green = Math.round(LS_clamp01(rgb[1]) * 255);
    c.blue = Math.round(LS_clamp01(rgb[2]) * 255);
    return c;
}

// ---- BridgeTalk transport ----------------------------------------------------------
// Data is passed using ExtendScript's built-in Object#toSource(), which serializes
// plain objects/arrays/primitives into directly re-executable JS source. This avoids
// any JSON dependency and is the standard idiom for BridgeTalk payloads.

function LS_targetRunning(targetName) {
    try {
        return BridgeTalk.isRunning(targetName);
    } catch (e) {
        return false;
    }
}

function LS_send(targetName, code, onResult, onError, timeoutSeconds) {
    if (!LS_targetRunning(targetName)) {
        var msg = "Target '" + targetName + "' is not running. Open it and try again.";
        LS_log(msg);
        if (onError) onError(msg);
        return;
    }
    var bt = new BridgeTalk();
    bt.target = targetName;
    bt.body = code;
    bt.onResult = function (res) {
        if (onResult) onResult(res.body);
    };
    bt.onError = function (err) {
        var m = (err && err.body) ? err.body : (err && err.message ? err.message : "unknown BridgeTalk error");
        LS_log("BridgeTalk error: " + m);
        if (onError) onError(m);
    };
    bt.send(timeoutSeconds || 30);
}

// Test-connection ping. Remote side just needs its own default engine alive.
function LS_testConnection(targetName, onSuccess, onError) {
    LS_send(targetName, "1+1;", function (body) {
        if (body === "2") {
            LS_log("Connection to '" + targetName + "' OK.");
            if (onSuccess) onSuccess();
        } else {
            var m = "Unexpected reply from '" + targetName + "': " + body;
            LS_log(m);
            if (onError) onError(m);
        }
    }, onError);
}
