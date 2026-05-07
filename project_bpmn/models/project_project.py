from odoo import models, fields, api


class ProjectProject(models.Model):
    _inherit = 'project.project'

    bpmn_diagram_ids = fields.One2many(
        'project.bpmn.diagram', 'project_id', string='BPMN Diagrams',
    )
    bpmn_diagram_count = fields.Integer(
        compute='_compute_bpmn_diagram_count', string='Diagrams',
    )

    @api.depends('bpmn_diagram_ids')
    def _compute_bpmn_diagram_count(self):
        for rec in self:
            rec.bpmn_diagram_count = len(rec.bpmn_diagram_ids)

    def action_view_bpmn_diagrams(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'BPMN Diagrams',
            'res_model': 'project.bpmn.diagram',
            'view_mode': 'list,form',
            'domain': [('project_id', '=', self.id)],
            'context': {
                'default_project_id': self.id,
                'default_name': self.name + ' — Process',
            },
        }
