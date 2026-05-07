import json
from odoo import models, fields, api


# Default diagram — a simple Start → Task → End template
_DEFAULT_DIAGRAM = json.dumps({
    "version": 1,
    "elements": {
        "start1": {"id": "start1", "type": "startEvent",
                   "x": 80,  "y": 182, "w": 36, "h": 36, "label": "Start"},
        "task1":  {"id": "task1",  "type": "task",
                   "x": 200, "y": 160, "w": 120, "h": 60, "label": "New Task"},
        "end1":   {"id": "end1",   "type": "endEvent",
                   "x": 400, "y": 182, "w": 36, "h": 36, "label": "End"},
    },
    "connections": {
        "seq1": {"id": "seq1", "sourceId": "start1", "targetId": "task1", "label": ""},
        "seq2": {"id": "seq2", "sourceId": "task1",  "targetId": "end1",  "label": ""},
    },
}, separators=(',', ':'))


class ProjectBpmnDiagram(models.Model):
    _name = 'project.bpmn.diagram'
    _description = 'BPMN Diagram'
    _inherit = ['mail.thread']
    _order = 'name'

    name = fields.Char('Diagram Name', required=True, tracking=True)
    project_id = fields.Many2one(
        'project.project', string='Project',
        ondelete='cascade', index=True,
    )
    task_id = fields.Many2one(
        'project.task', string='Task',
        ondelete='cascade', index=True,
    )
    description = fields.Text('Description')
    diagram_data = fields.Text(
        'Diagram Data',
        default=_DEFAULT_DIAGRAM,
        help='Internal JSON used by the diagram editor.',
    )
    element_count = fields.Integer(
        'Elements', compute='_compute_element_count', store=False,
    )

    @api.depends('diagram_data')
    def _compute_element_count(self):
        for rec in self:
            try:
                data = json.loads(rec.diagram_data or '{}')
                rec.element_count = len(data.get('elements', {}))
            except Exception:
                rec.element_count = 0
