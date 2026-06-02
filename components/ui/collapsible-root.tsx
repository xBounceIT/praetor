'use client';

import { Collapsible as CollapsiblePrimitive } from 'radix-ui';

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export { Collapsible };
