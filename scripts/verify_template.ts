
import { extractEnrichedFields } from '../src/services/saas/whatsapp/template.service.ts';

const mockComponents = [
  {
    type: 'HEADER',
    format: 'IMAGE'
  },
  {
    type: 'BODY',
    text: 'Hello {{1}}, how are you?'
  }
];

const result = extractEnrichedFields(mockComponents);
console.log(JSON.stringify(result, null, 2));
