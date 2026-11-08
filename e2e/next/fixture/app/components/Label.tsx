// No directive on purpose: rendered as a Server Component by app/page.tsx and
// as a Client Component by Toggle.tsx. Only the browser copy may be
// instrumented.
import { Fragment } from "react";

export function Label({ text }: { text: string }) {
  return (
    <Fragment>
      <span data-testid={`label-${text}`}>{text}</span>
    </Fragment>
  );
}
