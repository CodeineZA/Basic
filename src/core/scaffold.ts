/* What a new project starts life as.
 *
 * These are starter templates, not built-ins: they are written to disk as
 * ordinary YAML the moment a project is created, and the user is expected to
 * edit them. Nothing in the app treats them as special. */

import { stringify } from 'yaml';
import { DEFAULT_RELATIONS } from './project.ts';
import type { Template } from './types.ts';

export const STARTER_TEMPLATES: Template[] = [
    {
        id: 'character',
        label: 'Character',
        icon: 'user',
        color: '#7c9cbf',
        fields: [
            { key: 'role', label: 'Role', type: 'text' },
            { key: 'home', label: 'Home', type: 'ref', to: ['location'], rel: 'LOCATED_IN' },
        ],
        sections: [
            { key: 'gives', title: 'Gives and sells', query: { outgoing: { group: 'obtain' } } },
            { key: 'appears-in', title: 'Appears in', query: { incoming: ['INTRODUCES', 'FEATURES'] } },
        ],
    },
    {
        id: 'item',
        label: 'Item',
        icon: 'package',
        color: '#c2a36b',
        fields: [
            { key: 'value', label: 'Value', type: 'number' },
            { key: 'components', label: 'Crafted from', type: 'refQty', to: ['item'], rel: 'CRAFTED_FROM' },
        ],
        sections: [
            { key: 'available-from', title: 'Available from', query: { incoming: { group: 'obtain' } } },
            { key: 'used-in', title: 'Used in', query: { incoming: ['CRAFTED_FROM'] } },
            { key: 'appears-in', title: 'Appears in', query: { incoming: ['INTRODUCES', 'FEATURES'] } },
        ],
    },
    {
        id: 'location',
        label: 'Location',
        icon: 'map',
        color: '#7fa07a',
        fields: [
            { key: 'access', label: 'How to get in', type: 'longtext' },
            { key: 'connects_to', label: 'Connects to', type: 'refList', to: ['location'], rel: 'LOCATED_IN' },
        ],
        sections: [
            { key: 'contains', title: 'Contains', query: { incoming: ['LOCATED_IN'] } },
            { key: 'opened-by', title: 'Opened by', query: { incoming: ['OPENS'] } },
        ],
    },
];

export interface ScaffoldFile { path: string; text: string; }

const yaml = (v: unknown): string => stringify(v, { lineWidth: 0 });

/** Every file a brand-new project needs, as path/text pairs. */
export function scaffoldProject(name: string): ScaffoldFile[] {
    const files: ScaffoldFile[] = [
        {
            path: 'basic.json',
            text: `${JSON.stringify({ name, schemaVersion: 1, statuses: ['pending', 'in-progress', 'complete'] }, null, 2)}\n`,
        },
        { path: 'relations.yaml', text: yaml(DEFAULT_RELATIONS) },
        { path: 'flags.yaml', text: yaml([]) },
    ];
    for (const t of STARTER_TEMPLATES) {
        files.push({ path: `templates/${t.id}.yaml`, text: yaml(t) });
    }
    files.push({
        path: 'progression/act-1.md',
        text: `---\nid: act_1\ntype: act\nname: Act I\nbeats: []\n---\n\nWhat happens first.\n`,
    });
    return files;
}

/* An id is written for machines - kebab-case, lower - and a name is written for people.
 * Deriving one from the other on creation saves a rename that everyone forgets to do. */
export function humanise(id: string): string {
    return id
        .replace(/[-_]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A new object page: frontmatter for its template's fields, and room to write. */
export function newObjectPage(template: Template, id: string, name: string): string {
    const front: Record<string, unknown> = { id, type: template.id, name, status: 'pending' };
    for (const f of template.fields) {
        front[f.key] = f.type === 'refList' || f.type === 'refQty' ? [] : '';
    }
    return `---\n${yaml(front)}---\n\n`;
}
