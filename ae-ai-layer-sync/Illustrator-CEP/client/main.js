// main.js -- LayerSync CEP panel client.
//
// Uses the raw window.__adobe_cep__.evalScript(script, callback) bridge that
// the CEP host injects into every panel, rather than bundling Adobe's
// CSInterface.js wrapper (which this project doesn't ship a copy of). This is
// the lower-level primitive CSInterface.js itself wraps.

function evalJSX(script, callback) {
    window.__adobe_cep__.evalScript(script, function (result) {
        if (callback) callback(result);
    });
}

function setOptionsInHost() {
    var mirror = document.getElementById("mirrorCb").checked;
    var scale = document.getElementById("scaleField").value;
    evalJSX("LS_cepSetOptions(" + (mirror ? "true" : "false") + ", " + JSON.stringify(scale) + ");");
}

document.getElementById("pushBtn").addEventListener("click", function () {
    setOptionsInHost();
    evalJSX("LS_cepPush();");
});

document.getElementById("pullBtn").addEventListener("click", function () {
    setOptionsInHost();
    evalJSX("LS_cepPull();");
});

document.getElementById("testBtn").addEventListener("click", function () {
    evalJSX("LS_cepTestConnection();");
});

var lastLog = "";
function pollLog() {
    evalJSX("LS_cepGetLog();", function (result) {
        if (result && result !== lastLog) {
            lastLog = result;
            var box = document.getElementById("logBox");
            box.value = result;
            box.scrollTop = box.scrollHeight;
        }
    });
}
setInterval(pollLog, 700);
pollLog();
