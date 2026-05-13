{
    'name': 'Project BPMN Diagrams',
    'version': '19.0.1.0.0',
    'category': 'Project',
    'summary': 'Create, edit and export BPMN process diagrams inside Projects and Tasks',
    'description': """
Project BPMN Diagrams
=====================
Attach interactive BPMN 2.0 process diagrams to any project or task.

Features
--------
- Built-in drag-and-drop BPMN diagram editor (no external dependencies)
- BPMN 2.0 elements: Start/End Events, Tasks, Exclusive & Parallel Gateways, Annotations
- Draw sequence flows (arrows) between elements
- Double-click to rename any element inline
- Properties panel for the selected element
- Zoom in/out and fit-to-screen controls
- Delete key / toolbar Delete button removes selected element + its connections
- Export diagram as BPMN 2.0 XML (.bpmn) — importable by Camunda, Signavio, bpmn.io
- Export diagram as SVG vector image
- Smart buttons on Project and Task forms showing diagram count
- Chatter / mail tracking on diagrams
    """,
    'author': 'leapai.ai',
    'website': 'https://leapai.ai/en/',
    'support': 'abdzoro89@gmail.com',
    'maintainer': 'a.osman@bab.com.sa',
    'depends': ['project', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'views/project_bpmn_diagram_views.xml',
        'views/project_project_views.xml',
        'views/project_task_views.xml',
        'views/menu_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'project_bpmn/static/src/components/bpmn_editor/bpmn_editor.xml',
            'project_bpmn/static/src/components/bpmn_editor/bpmn_editor.js',
            'project_bpmn/static/src/components/bpmn_editor/bpmn_editor.scss',
        ],
    },
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
    'price': 0.0,
    'currency': 'EUR',
    'images': ['static/description/banner.svg', 'static/description/icon.png'],
}
