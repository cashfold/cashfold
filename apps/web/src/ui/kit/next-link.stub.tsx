import { forwardRef, type ComponentPropsWithoutRef } from 'react';

// Stands in for `next/link` in the kit's browser tests: the real one needs Next's runtime. Not part of the app.
const Link = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<'a'> & { href: string }>(function Link(props, ref) {
  return <a ref={ref} {...props} />;
});
export default Link;
