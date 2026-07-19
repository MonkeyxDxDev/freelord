// LayerSyncPanel.jsx (After Effects)
// Dockable ScriptUI panel that pushes/pulls the active comp's layer tree
// to/from Illustrator over BridgeTalk. Install into:
//   Scripts/ScriptUI Panels/  (see README.md)
//
// Requires Common/LayerSyncLib.jsx alongside this project's folder layout.

#include "../Common/LayerSyncLib.jsx"

var LS_TARGET = "illustrator";

// ---- Blend mode mapping (AE-only globals; must not appear in Common/*.jsx, since
// that file is #include'd into Illustrator's engine too where BlendingMode doesn't exist) --

var LS_BLEND_MAP = [
    ["NORMAL", BlendingMode.NORMAL],
    ["MULTIPLY", BlendingMode.MULTIPLY],
    ["SCREEN", BlendingMode.SCREEN],
    ["OVERLAY", BlendingMode.OVERLAY],
    ["DARKEN", BlendingMode.DARKEN],
    ["LIGHTEN", BlendingMode.LIGHTEN],
    ["COLOR_DODGE", BlendingMode.COLOR_DODGE],
    ["COLOR_BURN", BlendingMode.COLOR_BURN],
    ["HARD_LIGHT", BlendingMode.HARD_LIGHT],
    ["SOFT_LIGHT", BlendingMode.SOFT_LIGHT],
    ["DIFFERENCE", BlendingMode.DIFFERENCE],
    ["EXCLUSION", BlendingMode.EXCLUSION],
    ["HUE", BlendingMode.HUE],
    ["SATURATION", BlendingMode.SATURATION],
    ["COLOR", BlendingMode.COLOR],
    ["LUMINOSITY", BlendingMode.LUMINOSITY],
    ["ADD", BlendingMode.ADD]
];

function LS_aeBlendToWire(bm) {
    for (var i = 0; i < LS_BLEND_MAP.length; i++) if (LS_BLEND_MAP[i][1] === bm) return LS_BLEND_MAP[i][0];
    return "NORMAL";
}

function LS_wireToAEBlend(name) {
    for (var i = 0; i < LS_BLEND_MAP.length; i++) if (LS_BLEND_MAP[i][0] === name) return LS_BLEND_MAP[i][1];
    return BlendingMode.NORMAL;
}

function LS_localBBox(vertices) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < vertices.length; i++) {
        var v = vertices[i];
        if (v[0] < minX) minX = v[0];
        if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1];
        if (v[1] > maxY) maxY = v[1];
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

// =========================== Tree reading (AE -> wire) ===========================

function LS_classifyAELayer(layer) {
    if (layer instanceof TextLayer) return "text";
    if (layer instanceof ShapeLayer) return "shape";
    if (layer.nullLayer) return "group";
    return "other";
}

function LS_readAETransform(layer) {
    var t = layer.property("ADBE Transform Group");
    var pos = t.property("ADBE Position").value;
    var scale = t.property("ADBE Scale").value;
    var rotProp = t.property("ADBE Rotate Z");
    var rot = rotProp ? rotProp.value : 0;
    var opacity = t.property("ADBE Opacity").value;
    return {
        position: [LS_round2(pos[0]), LS_round2(pos[1])],
        scale: [LS_round2(scale[0]), LS_round2(scale[1])],
        rotation: LS_round2(rot),
        opacity: LS_round2(opacity)
    };
}

function LS_findPropByMatchName(group, matchName) {
    for (var i = 1; i <= group.numProperties; i++) {
        var p = group.property(i);
        if (p.matchName === matchName) return p;
    }
    return null;
}

// AE's native Gradient Fill vector property has no scriptable stop-editing API
// (its "Colors" parameter is dialog-only), so gradients round-trip through the
// classic "Ramp" effect instead, which fully supports scripting but only 2 stops.
function LS_readAERampGradient(layer) {
    try {
        var effects = layer.property("ADBE Effect Parade");
        var ramp = LS_findPropByMatchName(effects, "ADBE Ramp");
        if (!ramp) return null;
        var startPt = ramp.property("ADBE Ramp-0001").value;
        var startColor = ramp.property("ADBE Ramp-0002").value;
        var endPt = ramp.property("ADBE Ramp-0003").value;
        var endColor = ramp.property("ADBE Ramp-0004").value;
        var shapeType = ramp.property("ADBE Ramp-0005").value; // 1 = linear, 2 = radial
        var dx = endPt[0] - startPt[0], dy = endPt[1] - startPt[1];
        var angle = Math.atan2(dy, dx) * 180 / Math.PI; // canonical (AE-space, Y-down) degrees
        return {
            type: shapeType === 2 ? "radial" : "linear",
            angle: LS_round2(angle),
            stops: [
                { ramp: 0, color: [LS_round2(startColor[0]), LS_round2(startColor[1]), LS_round2(startColor[2])] },
                { ramp: 100, color: [LS_round2(endColor[0]), LS_round2(endColor[1]), LS_round2(endColor[2])] }
            ]
        };
    } catch (e) {
        LS_log("Ramp gradient read failed on '" + layer.name + "': " + e);
        return null;
    }
}

function LS_readAEShape(layer) {
    try {
        var contents = layer.property("ADBE Root Vectors Group");
        if (contents.numProperties < 1) return null;
        var group = contents.property(1);
        var vg = group.property("ADBE Vectors Group");
        var pathGroup = LS_findPropByMatchName(vg, "ADBE Vector Shape - Group");
        if (!pathGroup) return null;
        var shapeVal = pathGroup.property("ADBE Vector Shape").value;

        var fillGradient = LS_readAERampGradient(layer);
        var fillColor = null, strokeColor = null, strokeWidth = 0;
        if (!fillGradient) {
            var fillProp = LS_findPropByMatchName(vg, "ADBE Vector Graphic - Fill");
            if (fillProp) {
                var fc = fillProp.property("ADBE Vector Fill Color").value;
                fillColor = [LS_round2(fc[0]), LS_round2(fc[1]), LS_round2(fc[2])];
            }
        }
        var strokeProp = LS_findPropByMatchName(vg, "ADBE Vector Graphic - Stroke");
        if (strokeProp) {
            var sc = strokeProp.property("ADBE Vector Stroke Color").value;
            strokeColor = [LS_round2(sc[0]), LS_round2(sc[1]), LS_round2(sc[2])];
            strokeWidth = strokeProp.property("ADBE Vector Stroke Width").value;
        }

        return {
            closed: shapeVal.closed,
            vertices: shapeVal.vertices,
            inTangents: shapeVal.inTangents,
            outTangents: shapeVal.outTangents,
            fillColor: fillColor,
            fillGradient: fillGradient,
            strokeColor: strokeColor,
            strokeWidth: strokeWidth
        };
    } catch (e) {
        LS_log("Shape read failed on '" + layer.name + "': " + e);
        return null;
    }
}

function LS_readAEText(layer) {
    try {
        var st = layer.property("Source Text").value;
        var just = "left";
        if (st.justification === ParagraphJustification.CENTER_JUSTIFY) just = "center";
        else if (st.justification === ParagraphJustification.RIGHT_JUSTIFY) just = "right";
        var fill = [0, 0, 0];
        try { fill = [LS_round2(st.fillColor[0]), LS_round2(st.fillColor[1]), LS_round2(st.fillColor[2])]; } catch (e2) {}
        return {
            contents: st.text,
            fontName: st.font,
            fontSize: st.fontSize,
            fillColor: fill,
            justification: just
        };
    } catch (e) {
        LS_log("Text read failed on '" + layer.name + "': " + e);
        return null;
    }
}

function LS_buildAENode(layer, childMap) {
    var node = {
        name: layer.name,
        kind: LS_classifyAELayer(layer),
        visible: layer.enabled,
        blendMode: LS_aeBlendToWire(layer.blendingMode),
        transform: LS_readAETransform(layer)
    };
    if (node.kind === "shape") {
        node.shape = LS_readAEShape(layer);
        if (!node.shape) node.kind = "other";
    } else if (node.kind === "text") {
        node.text = LS_readAEText(layer);
        if (!node.text) node.kind = "other";
    }
    var kids = childMap[layer.index];
    if (kids && kids.length) {
        node.children = [];
        for (var k = 0; k < kids.length; k++) {
            node.children.push(LS_buildAENode(kids[k], childMap));
        }
    }
    return node;
}

function LS_buildAETree() {
    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        LS_log("No active composition selected.");
        return null;
    }
    var roots = [];
    var childMap = {};
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layers[i];
        if (l.parent) {
            var pid = l.parent.index;
            if (!childMap[pid]) childMap[pid] = [];
            childMap[pid].push(l);
        } else {
            roots.push(l);
        }
    }
    var out = [];
    for (var r = 0; r < roots.length; r++) {
        var n = LS_buildAENode(roots[r], childMap);
        if (n.kind !== "other" || (n.children && n.children.length)) out.push(n);
        else LS_log("Skipping unsupported layer: " + roots[r].name);
    }
    return { version: 1, source: "AE", canvas: { width: comp.width, height: comp.height }, layers: out };
}

// =========================== Tree applying (wire -> AE) ===========================

function LS_findAELayerByName(comp, name, parentLayer) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layers[i];
        var sameParent = (!parentLayer && !l.parent) || (parentLayer && l.parent && l.parent.index === parentLayer.index);
        if (l.name === name && sameParent) return l;
    }
    return null;
}

function LS_applyAETransform(layer, transform) {
    if (!transform) return;
    var t = layer.property("ADBE Transform Group");
    t.property("ADBE Position").setValue([transform.position[0], transform.position[1]]);
    t.property("ADBE Scale").setValue([transform.scale[0], transform.scale[1]]);
    var rotProp = t.property("ADBE Rotate Z");
    if (rotProp) rotProp.setValue(transform.rotation);
    t.property("ADBE Opacity").setValue(transform.opacity);
}

function LS_createOrUpdateAEShape(comp, node, parentLayer) {
    var layer = LS_findAELayerByName(comp, node.name, parentLayer);
    if (!layer) {
        layer = comp.layers.addShape();
        layer.name = node.name;
        if (parentLayer) layer.parent = parentLayer;
    }
    layer.enabled = node.visible !== false;
    layer.blendingMode = LS_wireToAEBlend(node.blendMode || "NORMAL");
    LS_applyAETransform(layer, node.transform);

    if (node.shape) {
        var contents = layer.property("ADBE Root Vectors Group");
        while (contents.numProperties > 0) contents.property(1).remove();
        var group = contents.addProperty("ADBE Vector Group");
        var vg = group.property("ADBE Vectors Group");
        var pathGroup = vg.addProperty("ADBE Vector Shape - Group");
        var shapeProp = pathGroup.property("ADBE Vector Shape");

        var s = new Shape();
        s.vertices = node.shape.vertices;
        s.inTangents = node.shape.inTangents;
        s.outTangents = node.shape.outTangents;
        s.closed = node.shape.closed;
        shapeProp.setValue(s);

        var effects = layer.property("ADBE Effect Parade");
        var existingRamp = LS_findPropByMatchName(effects, "ADBE Ramp");

        if (node.shape.fillGradient) {
            var fg = node.shape.fillGradient;
            var bbox = LS_localBBox(node.shape.vertices);
            var cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
            var r = Math.sqrt(Math.pow(bbox.maxX - bbox.minX, 2) + Math.pow(bbox.maxY - bbox.minY, 2)) / 2;
            if (r < 1) r = 1;
            var rad = fg.angle * Math.PI / 180;
            var dx = Math.cos(rad), dy = Math.sin(rad);
            var startPt = [cx - r * dx, cy - r * dy], endPt = [cx + r * dx, cy + r * dy];

            var ramp = existingRamp || effects.addProperty("ADBE Ramp");
            ramp.property("ADBE Ramp-0001").setValue(startPt);
            ramp.property("ADBE Ramp-0002").setValue(fg.stops[0].color);
            ramp.property("ADBE Ramp-0003").setValue(endPt);
            ramp.property("ADBE Ramp-0004").setValue(fg.stops[fg.stops.length - 1].color);
            ramp.property("ADBE Ramp-0005").setValue(fg.type === "radial" ? 2 : 1);
            if (fg.stops.length > 2) {
                LS_log("Gradient on '" + node.name + "' has " + fg.stops.length + " stops; the AE Ramp effect only supports 2, using first/last.");
            }
        } else {
            if (existingRamp) existingRamp.remove();
            if (node.shape.fillColor) {
                var fill = vg.addProperty("ADBE Vector Graphic - Fill");
                fill.property("ADBE Vector Fill Color").setValue(node.shape.fillColor);
            }
        }
        if (node.shape.strokeColor) {
            var stroke = vg.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Color").setValue(node.shape.strokeColor);
            stroke.property("ADBE Vector Stroke Width").setValue(node.shape.strokeWidth || 1);
        }
    }
    return layer;
}

function LS_createOrUpdateAEText(comp, node, parentLayer) {
    var layer = LS_findAELayerByName(comp, node.name, parentLayer);
    if (!layer) {
        layer = comp.layers.addText(node.text ? node.text.contents : "");
        layer.name = node.name;
        if (parentLayer) layer.parent = parentLayer;
    }
    layer.enabled = node.visible !== false;
    layer.blendingMode = LS_wireToAEBlend(node.blendMode || "NORMAL");
    LS_applyAETransform(layer, node.transform);

    if (node.text) {
        var textProp = layer.property("Source Text");
        var td = textProp.value;
        td.text = node.text.contents;
        try { td.font = node.text.fontName; } catch (e) { LS_log("Font '" + node.text.fontName + "' not found, keeping default."); }
        td.fontSize = node.text.fontSize;
        td.fillColor = node.text.fillColor;
        td.justification = node.text.justification === "center" ? ParagraphJustification.CENTER_JUSTIFY :
            node.text.justification === "right" ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.LEFT_JUSTIFY;
        textProp.setValue(td);
    }
    return layer;
}

function LS_createOrUpdateAEGroup(comp, node, parentLayer) {
    var layer = LS_findAELayerByName(comp, node.name, parentLayer);
    if (!layer) {
        layer = comp.layers.addNull();
        layer.name = node.name;
        if (parentLayer) layer.parent = parentLayer;
    }
    layer.enabled = node.visible !== false;
    layer.blendingMode = LS_wireToAEBlend(node.blendMode || "NORMAL");
    LS_applyAETransform(layer, node.transform);
    return layer;
}

function LS_applyNodesAE(comp, nodes, parentLayer, mirrorDelete) {
    var incomingNames = {};
    for (var i = 0; i < nodes.length; i++) incomingNames[nodes[i].name] = true;

    if (mirrorDelete) {
        for (var j = comp.numLayers; j >= 1; j--) {
            var l = comp.layers[j];
            var sameParent = (!parentLayer && !l.parent) || (parentLayer && l.parent && l.parent.index === parentLayer.index);
            if (sameParent && !incomingNames[l.name]) {
                LS_log("Removing AE layer not in source: " + l.name);
                l.remove();
            }
        }
    }

    for (var k = 0; k < nodes.length; k++) {
        var node = nodes[k];
        var layer;
        if (node.kind === "shape") layer = LS_createOrUpdateAEShape(comp, node, parentLayer);
        else if (node.kind === "text") layer = LS_createOrUpdateAEText(comp, node, parentLayer);
        else layer = LS_createOrUpdateAEGroup(comp, node, parentLayer);

        if (node.children && node.children.length) {
            LS_applyNodesAE(comp, node.children, layer, mirrorDelete);
        }
    }
}

var LS_mirrorDeleteFlag = false;

function LS_applyIncomingTree(tree) {
    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        LS_log("Pull/push-receive failed: no active composition.");
        return;
    }
    app.beginUndoGroup("Layer Sync: Apply Illustrator Layers");
    try {
        LS_applyNodesAE(comp, tree.layers, null, LS_mirrorDeleteFlag);
        LS_log("Applied incoming tree from " + tree.source + " (" + tree.layers.length + " root layers).");
    } catch (e) {
        LS_log("Apply error: " + e);
    }
    app.endUndoGroup();
}

// Called by a remote BridgeTalk "pull" request from Illustrator.
function LS_getTreeSource() {
    var tree = LS_buildAETree();
    if (!tree) return "null";
    return tree.toSource();
}

// =========================== Push / Pull actions ===========================

function LS_doPush() {
    var tree = LS_buildAETree();
    if (!tree) return;
    LS_log("Pushing " + tree.layers.length + " root layer(s) to Illustrator...");
    LS_send(LS_TARGET, "LS_applyIncomingTree(" + tree.toSource() + ");", function () {
        LS_log("Push complete.");
    }, function (err) {
        LS_log("Push failed: " + err);
    });
}

function LS_doPull() {
    LS_log("Requesting layers from Illustrator...");
    LS_send(LS_TARGET, "LS_getTreeSource();", function (body) {
        try {
            var tree = eval(body);
            if (!tree) { LS_log("Illustrator returned no data."); return; }
            LS_applyIncomingTree(tree);
        } catch (e) {
            LS_log("Failed to parse Illustrator response: " + e);
        }
    }, function (err) {
        LS_log("Pull failed: " + err);
    });
}

// =========================== ScriptUI panel ===========================

function LS_buildAEPanel(thisObj) {
    var win = (thisObj instanceof Panel) ? thisObj : new Window("palette", "AE ⇄ AI Layer Sync", undefined, { resizeable: true });
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 8;
    win.margins = 12;

    var row1 = win.add("group");
    row1.orientation = "row";
    var pushBtn = row1.add("button", undefined, "Push → Illustrator");
    var pullBtn = row1.add("button", undefined, "Pull ← Illustrator");
    var testBtn = row1.add("button", undefined, "Test Connection");

    var row2 = win.add("group");
    row2.orientation = "row";
    var mirrorCb = row2.add("checkbox", undefined, "Mirror delete");
    mirrorCb.value = false;
    row2.add("statictext", undefined, "Units scale (AI pt / AE px):");
    var scaleField = row2.add("edittext", undefined, String(LS_UNITS_SCALE));
    scaleField.characters = 5;

    var logBox = win.add("edittext", undefined, "", { multiline: true, scrolling: true, readonly: true });
    logBox.preferredSize = [340, 220];
    LS_setLogTarget(logBox);

    mirrorCb.onClick = function () { LS_mirrorDeleteFlag = mirrorCb.value; };
    scaleField.onChange = function () {
        var v = parseFloat(scaleField.text);
        if (!isNaN(v) && v > 0) LS_UNITS_SCALE = v;
        else scaleField.text = String(LS_UNITS_SCALE);
    };

    pushBtn.onClick = function () { LS_doPush(); };
    pullBtn.onClick = function () { LS_doPull(); };
    testBtn.onClick = function () {
        LS_testConnection(LS_TARGET, function () {}, function () {});
    };

    win.layout.layout(true);
    return win;
}

var LS_aePanelWindow = LS_buildAEPanel(this);
if (LS_aePanelWindow instanceof Window) {
    LS_aePanelWindow.center();
    LS_aePanelWindow.show();
}
