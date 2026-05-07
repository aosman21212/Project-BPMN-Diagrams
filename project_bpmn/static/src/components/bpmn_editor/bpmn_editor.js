/** @odoo-module **/

import { Component, useState, useRef, useEffect, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

// ─── Element configuration ────────────────────────────────────────────────────
const ELEM_CFG = {
    startEvent:        { w: 36,  h: 36,  label: "Start"   },
    endEvent:          { w: 36,  h: 36,  label: "End"     },
    task:              { w: 120, h: 60,  label: "Task"    },
    exclusiveGateway:  { w: 50,  h: 50,  label: ""        },
    parallelGateway:   { w: 50,  h: 50,  label: ""        },
    annotation:        { w: 130, h: 55,  label: "Note"    },
};

// ─── Unique-ID generator ──────────────────────────────────────────────────────
let _idCounter = Date.now();
const genId = (prefix = "e") => `${prefix}_${(_idCounter++).toString(36)}`;

// ─── Default diagram (Start → Task → End) ────────────────────────────────────
const DEFAULT_DIAGRAM = {
    version: 1,
    elements: {
        start1: { id: "start1", type: "startEvent",  x: 80,  y: 182, w: 36,  h: 36, label: "Start"    },
        task1:  { id: "task1",  type: "task",         x: 200, y: 160, w: 120, h: 60, label: "New Task"  },
        end1:   { id: "end1",   type: "endEvent",     x: 420, y: 182, w: 36,  h: 36, label: "End"      },
    },
    connections: {
        seq1: { id: "seq1", sourceId: "start1", targetId: "task1", label: "" },
        seq2: { id: "seq2", sourceId: "task1",  targetId: "end1",  label: "" },
    },
};

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** Find the point on an element's boundary closest to (fromX, fromY). */
function boundaryPoint(el, fromX, fromY) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const dx = fromX - cx;
    const dy = fromY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (el.type === "startEvent" || el.type === "endEvent") {
        const r = el.w / 2 - 1;
        if (dist < 0.001) return { x: cx, y: cy };
        return { x: cx + (r * dx) / dist, y: cy + (r * dy) / dist };
    }

    // Rectangle (task, gateway approximated as rect, annotation)
    const hw = el.w / 2;
    const hh = el.h / 2;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
    const sx = Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity;
    const sy = Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity;
    const s  = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
}

/** Returns true if screen point (x,y) is inside the element's hit area. */
function hitTest(el, x, y) {
    if (el.type === "startEvent" || el.type === "endEvent") {
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2;
        const r  = el.w / 2 + 4;           // slightly larger hit area
        return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
    }
    return x >= el.x - 4 && x <= el.x + el.w + 4 &&
           y >= el.y - 4 && y <= el.y + el.h + 4;
}

// ─── BPMN 2.0 XML export ─────────────────────────────────────────────────────

function generateBpmnXml(elements, connections) {
    const processId = "Process_1";

    // Build incoming / outgoing maps
    const incoming = {};
    const outgoing = {};
    for (const c of Object.values(connections)) {
        (outgoing[c.sourceId] = outgoing[c.sourceId] || []).push(c.id);
        (incoming[c.targetId] = incoming[c.targetId] || []).push(c.id);
    }

    const esc = s => (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Semantic nodes
    const nodesXml = Object.values(elements).map(el => {
        const inc = (incoming[el.id] || []).map(id => `      <incoming>${id}</incoming>`).join("\n");
        const out = (outgoing[el.id] || []).map(id => `      <outgoing>${id}</outgoing>`).join("\n");
        const inner = [inc, out].filter(Boolean).join("\n");
        const na = el.label ? ` name="${esc(el.label)}"` : "";
        if (el.type === "annotation") {
            return `    <textAnnotation id="${el.id}"${na}><text>${esc(el.label)}</text></textAnnotation>`;
        }
        return inner
            ? `    <${el.type} id="${el.id}"${na}>\n${inner}\n    </${el.type}>`
            : `    <${el.type} id="${el.id}"${na}/>`;
    }).join("\n");

    // Sequence flows
    const seqXml = Object.values(connections).map(c => {
        const na = c.label ? ` name="${esc(c.label)}"` : "";
        return `    <sequenceFlow id="${c.id}"${na} sourceRef="${c.sourceId}" targetRef="${c.targetId}"/>`;
    }).join("\n");

    // DI shapes
    const shapesXml = Object.values(elements).map(el => {
        const marker = (el.type === "exclusiveGateway" || el.type === "parallelGateway")
            ? ' isMarkerVisible="true"' : "";
        return `      <bpmndi:BPMNShape id="${el.id}_di" bpmnElement="${el.id}"${marker}>\n` +
               `        <dc:Bounds x="${Math.round(el.x)}" y="${Math.round(el.y)}" width="${el.w}" height="${el.h}"/>\n` +
               `        <bpmndi:BPMNLabel/>\n` +
               `      </bpmndi:BPMNShape>`;
    }).join("\n");

    // DI edges
    const edgesXml = Object.values(connections).map(c => {
        const s = elements[c.sourceId];
        const t = elements[c.targetId];
        if (!s || !t) return "";
        const sCx = s.x + s.w / 2, sCy = s.y + s.h / 2;
        const tCx = t.x + t.w / 2, tCy = t.y + t.h / 2;
        const sp  = boundaryPoint(s, tCx, tCy);
        const tp  = boundaryPoint(t, sCx, sCy);
        return `      <bpmndi:BPMNEdge id="${c.id}_di" bpmnElement="${c.id}">\n` +
               `        <di:waypoint x="${Math.round(sp.x)}" y="${Math.round(sp.y)}"/>\n` +
               `        <di:waypoint x="${Math.round(tp.x)}" y="${Math.round(tp.y)}"/>\n` +
               `      </bpmndi:BPMNEdge>`;
    }).filter(Boolean).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
             id="Definitions_1"
             targetNamespace="http://bpmn.io/schema/bpmn"
             exporter="Odoo Project BPMN">
  <process id="${processId}" isExecutable="false">
${nodesXml}
${seqXml}
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
${shapesXml}
${edgesXml}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;
}

// ─── File download helper ─────────────────────────────────────────────────────
function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── OWL Component ───────────────────────────────────────────────────────────

export class BpmnEditorField extends Component {
    static template = "project_bpmn.BpmnEditorField";
    static props    = { ...standardFieldProps };

    setup() {
        this.svgRef        = useRef("bpmnSvg");
        this.labelInputRef = useRef("labelInput");

        // Parse stored value or fall back to default diagram
        const stored = this.props.record.data[this.props.name];
        let initial;
        try { initial = stored ? JSON.parse(stored) : DEFAULT_DIAGRAM; }
        catch { initial = DEFAULT_DIAGRAM; }

        this.state = useState({
            elements:       { ...initial.elements    },
            connections:    { ...initial.connections },
            selectedId:     null,
            tool:           "pointer",
            // pointer drag
            isDragging:     false,
            dragOffX:       0,
            dragOffY:       0,
            // connect mode
            connectFrom:    null,
            mouseX:         0,
            mouseY:         0,
            // view
            zoom:           1,
            panX:           0,
            panY:           0,
            // inline label editing
            editingId:      null,
            editingLabel:   "",
        });

        // Auto-focus label input when it appears
        useEffect(
            (editingId) => {
                if (editingId && this.labelInputRef.el) {
                    this.labelInputRef.el.focus();
                    this.labelInputRef.el.select();
                }
            },
            () => [this.state.editingId],
        );

        // Attach non-passive wheel listener + global mouseup
        onMounted(() => {
            const svg = this.svgRef.el;
            if (svg) {
                this._wheelHandler = (ev) => { ev.preventDefault(); this._handleWheel(ev); };
                svg.addEventListener("wheel", this._wheelHandler, { passive: false });
            }
            this._globalMouseUp = () => { this.state.isDragging = false; };
            document.addEventListener("mouseup", this._globalMouseUp);
        });
        onWillUnmount(() => {
            if (this.svgRef.el) this.svgRef.el.removeEventListener("wheel", this._wheelHandler);
            document.removeEventListener("mouseup", this._globalMouseUp);
        });
    }

    // ── Coordinate utilities ──────────────────────────────────────────────

    /** Convert a browser clientX/Y into SVG canvas coordinates. */
    _svgCoords(clientX, clientY) {
        const rect = this.svgRef.el.getBoundingClientRect();
        return {
            x: (clientX - rect.left) / this.state.zoom - this.state.panX,
            y: (clientY - rect.top)  / this.state.zoom - this.state.panY,
        };
    }

    /** Find the top-most element at SVG canvas point (x, y). */
    _elementAt(x, y) {
        const elems = Object.values(this.state.elements).reverse();
        return elems.find(el => hitTest(el, x, y)) || null;
    }

    // ── Tool selection ────────────────────────────────────────────────────

    setTool(tool) {
        this.state.tool = tool;
        this.state.connectFrom = null;
    }

    get toolLabel() {
        const map = {
            pointer: "Select/Move", connect: "Draw Connection",
            add_startEvent: "Add Start Event", add_endEvent: "Add End Event",
            add_task: "Add Task", add_exclusiveGateway: "Add Gateway (XOR)",
            add_parallelGateway: "Add Gateway (AND)", add_annotation: "Add Annotation",
        };
        return map[this.state.tool] || this.state.tool;
    }

    // ── Canvas event handlers ─────────────────────────────────────────────

    /** Background click / canvas-level mousedown (elements stop propagation). */
    onSvgMouseDown(ev) {
        const { x, y } = this._svgCoords(ev.clientX, ev.clientY);
        const tool = this.state.tool;

        if (tool.startsWith("add_")) {
            const type = tool.replace("add_", "");
            this._addElement(type, x, y);
            this._save();
            return;
        }

        // In connect mode — clicking empty space cancels
        if (tool === "connect") {
            this.state.connectFrom = null;
            return;
        }

        // Pointer mode — deselect
        this.state.selectedId = null;
    }

    onSvgMouseMove(ev) {
        const { x, y } = this._svgCoords(ev.clientX, ev.clientY);
        this.state.mouseX = x;
        this.state.mouseY = y;

        if (this.state.isDragging && this.state.selectedId) {
            const el = this.state.elements[this.state.selectedId];
            if (el) {
                el.x = x - this.state.dragOffX;
                el.y = y - this.state.dragOffY;
                this._save();
            }
        }
    }

    onSvgMouseUp() {
        this.state.isDragging = false;
    }

    _handleWheel(ev) {
        const factor = ev.deltaY < 0 ? 1.1 : 0.9;
        this.state.zoom = Math.max(0.2, Math.min(4, this.state.zoom * factor));
    }

    // ── Element event handlers ────────────────────────────────────────────

    onElemMouseDown(ev, elemId) {
        ev.stopPropagation();
        if (this.props.readonly) return;

        const tool = this.state.tool;

        if (tool === "connect") {
            if (!this.state.connectFrom) {
                this.state.connectFrom = elemId;
            } else if (this.state.connectFrom !== elemId) {
                this._addConnection(this.state.connectFrom, elemId);
                this.state.connectFrom = null;
                this._save();
            }
            return;
        }

        if (tool === "pointer") {
            this.state.selectedId  = elemId;
            this.state.isDragging  = true;
            const el = this.state.elements[elemId];
            const { x, y } = this._svgCoords(ev.clientX, ev.clientY);
            this.state.dragOffX = x - el.x;
            this.state.dragOffY = y - el.y;
        }

        // In add mode, clicking an element selects it + resets tool
        if (tool.startsWith("add_")) {
            this.state.tool = "pointer";
            this.state.selectedId = elemId;
        }
    }

    onElemDblClick(ev, elemId) {
        ev.stopPropagation();
        if (this.props.readonly) return;
        const el = this.state.elements[elemId];
        if (el) {
            this.state.editingId    = elemId;
            this.state.editingLabel = el.label || "";
        }
    }

    // ── Connection click ──────────────────────────────────────────────────

    onConnClick(ev, connId) {
        ev.stopPropagation();
        this.state.selectedId = connId;
    }

    onConnDblClick(ev, connId) {
        ev.stopPropagation();
        if (this.props.readonly) return;
        const conn = this.state.connections[connId];
        if (!conn) return;
        this.state.editingId    = connId;
        this.state.editingLabel = conn.label || "";
    }

    // ── Inline label editing ──────────────────────────────────────────────

    onLabelInput(ev) {
        this.state.editingLabel = ev.target.value;
    }

    onLabelKeyDown(ev) {
        if (ev.key === "Enter") { ev.preventDefault(); this._finishEdit(); }
        if (ev.key === "Escape") { this.state.editingId = null; }
    }

    onLabelBlur() { this._finishEdit(); }

    _finishEdit() {
        const id = this.state.editingId;
        if (!id) return;
        if (this.state.elements[id]) {
            this.state.elements[id].label = this.state.editingLabel;
        } else if (this.state.connections[id]) {
            this.state.connections[id].label = this.state.editingLabel;
        }
        this.state.editingId = null;
        this._save();
    }

    // ── Properties panel ──────────────────────────────────────────────────

    onPropLabelInput(ev) {
        const id = this.state.selectedId;
        if (!id) return;
        if (this.state.elements[id])    this.state.elements[id].label    = ev.target.value;
        if (this.state.connections[id]) this.state.connections[id].label = ev.target.value;
        this._save();
    }

    // ── CRUD ─────────────────────────────────────────────────────────────

    _addElement(type, cx, cy) {
        const cfg = ELEM_CFG[type] || ELEM_CFG.task;
        const id  = genId("elem");
        this.state.elements[id] = {
            id, type,
            x: cx - cfg.w / 2,
            y: cy - cfg.h / 2,
            w: cfg.w, h: cfg.h,
            label: cfg.label,
        };
        this.state.selectedId = id;
        this.state.tool = "pointer";
    }

    _addConnection(sourceId, targetId) {
        // Prevent duplicates
        const dup = Object.values(this.state.connections)
            .find(c => c.sourceId === sourceId && c.targetId === targetId);
        if (dup) return;
        const id = genId("seq");
        this.state.connections[id] = { id, sourceId, targetId, label: "" };
    }

    deleteSelected() {
        const id = this.state.selectedId;
        if (!id) return;

        if (this.state.elements[id]) {
            delete this.state.elements[id];
            // Remove dangling connections
            for (const cid of Object.keys(this.state.connections)) {
                const c = this.state.connections[cid];
                if (c.sourceId === id || c.targetId === id) {
                    delete this.state.connections[cid];
                }
            }
        } else if (this.state.connections[id]) {
            delete this.state.connections[id];
        }

        this.state.selectedId = null;
        this._save();
    }

    // ── Zoom / fit ────────────────────────────────────────────────────────

    zoomIn()  { this.state.zoom = Math.min(4, this.state.zoom * 1.25); }
    zoomOut() { this.state.zoom = Math.max(0.2, this.state.zoom / 1.25); }

    fitToScreen() {
        const els = Object.values(this.state.elements);
        if (!els.length) return;
        const pad  = 60;
        const minX = Math.min(...els.map(e => e.x)) - pad;
        const minY = Math.min(...els.map(e => e.y)) - pad;
        const maxX = Math.max(...els.map(e => e.x + e.w)) + pad;
        const maxY = Math.max(...els.map(e => e.y + e.h)) + pad;
        const svgEl = this.svgRef.el;
        if (!svgEl) return;
        const W = svgEl.clientWidth  || 800;
        const H = svgEl.clientHeight || 500;
        const z = Math.min(W / (maxX - minX), H / (maxY - minY), 2);
        this.state.zoom = z;
        this.state.panX = -minX + (W / z - (maxX - minX)) / 2;
        this.state.panY = -minY + (H / z - (maxY - minY)) / 2;
    }

    // ── Keyboard shortcut ─────────────────────────────────────────────────

    onKeyDown(ev) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if ((ev.key === "Delete" || ev.key === "Backspace") && this.state.selectedId) {
            ev.preventDefault();
            this.deleteSelected();
        }
        if (ev.key === "Escape") {
            this.state.tool = "pointer";
            this.state.connectFrom = null;
        }
    }

    // ── Persistence ───────────────────────────────────────────────────────

    _save() {
        if (this.props.readonly) return;
        const data = JSON.stringify({
            version: 1,
            elements:    { ...this.state.elements    },
            connections: { ...this.state.connections },
        });
        this.props.record.update({ [this.props.name]: data });
    }

    // ── Computed view helpers ─────────────────────────────────────────────

    get elementsList() {
        return Object.values(this.state.elements);
    }

    get connectionsList() {
        return Object.values(this.state.connections).map(c => {
            const s = this.state.elements[c.sourceId];
            const t = this.state.elements[c.targetId];
            if (!s || !t) return null;
            const sCx = s.x + s.w / 2, sCy = s.y + s.h / 2;
            const tCx = t.x + t.w / 2, tCy = t.y + t.h / 2;
            const sp  = boundaryPoint(s, tCx, tCy);
            const tp  = boundaryPoint(t, sCx, sCy);
            return {
                ...c,
                x1: sp.x, y1: sp.y,
                x2: tp.x, y2: tp.y,
                midX: (sp.x + tp.x) / 2,
                midY: (sp.y + tp.y) / 2,
            };
        }).filter(Boolean);
    }

    get selectedElement() {
        const id = this.state.selectedId;
        return id ? this.state.elements[id] || null : null;
    }

    get selectedConnection() {
        const id = this.state.selectedId;
        return id ? this.state.connections[id] || null : null;
    }

    get connectingFromElem() {
        return this.state.connectFrom ? this.state.elements[this.state.connectFrom] || null : null;
    }

    /** SVG <polygon> points for a gateway diamond. */
    gatewayPoints(el) {
        const cx = el.w / 2, cy = el.h / 2;
        return `${cx},0 ${el.w},${cy} ${cx},${el.h} 0,${cy}`;
    }

    /** Position of the inline label editor overlay in px relative to canvas area. */
    get labelEditorStyle() {
        const id = this.state.editingId;
        if (!id) return "";
        const rec = this.state.elements[id] || this.state.connections[id];
        let cx, cy;
        if (this.state.elements[id]) {
            cx = (rec.x + rec.w / 2) * this.state.zoom + this.state.panX * this.state.zoom;
            cy = (rec.y + rec.h / 2) * this.state.zoom + this.state.panY * this.state.zoom;
        } else {
            // Connection label — use midpoint from connectionsList
            const conn = this.connectionsList.find(c => c.id === id);
            if (!conn) return "";
            cx = conn.midX * this.state.zoom + this.state.panX * this.state.zoom;
            cy = conn.midY * this.state.zoom + this.state.panY * this.state.zoom;
        }
        return `left:${Math.round(cx - 65)}px; top:${Math.round(cy - 14)}px;`;
    }

    // ── Exports ───────────────────────────────────────────────────────────

    exportBpmn() {
        const xml  = generateBpmnXml(this.state.elements, this.state.connections);
        const name = (this.props.record.data.name || "diagram").replace(/[^a-z0-9_-]/gi, "_");
        downloadFile(`${name}.bpmn`, xml, "application/xml");
    }

    exportSvg() {
        const svgEl = this.svgRef.el;
        if (!svgEl) return;
        const clone = svgEl.cloneNode(true);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const serializer = new XMLSerializer();
        const content    = serializer.serializeToString(clone);
        const name = (this.props.record.data.name || "diagram").replace(/[^a-z0-9_-]/gi, "_");
        downloadFile(`${name}.svg`, content, "image/svg+xml");
    }
}

registry.category("fields").add("bpmn_editor", {
    component: BpmnEditorField,
    supportedTypes: ["text"],
});
