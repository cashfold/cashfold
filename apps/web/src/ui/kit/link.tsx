// Derived from Catalyst (Tailwind Plus). Licence: ./LICENSE-TAILWIND-PLUS.md
import * as Headless from '@headlessui/react'
import NextLink from 'next/link'
import React, { forwardRef } from 'react'

// Client-side navigation through Next's router (the static export has no server). Headless's DataInteractive keeps the
// focus and hover data attributes the kit's styles use.
export const Link = forwardRef(function Link(
  props: React.ComponentPropsWithoutRef<typeof NextLink>,
  ref: React.ForwardedRef<HTMLAnchorElement>
) {
  return (
    <Headless.DataInteractive>
      <NextLink {...props} ref={ref} />
    </Headless.DataInteractive>
  )
})
