// A React Server Component that imports from "react". Before the Next.js
// wrapper, the Babel setup injected useRef/useEffect here and Next refused to
// compile it ("only works in a Client Component").
import { Suspense } from "react";
import Toggle from "./components/Toggle";
import { Label } from "./components/Label";

export default function Home() {
  return (
    <main>
      <Suspense fallback={<p>loading</p>}>
        <p data-testid="server-rendered">rendered on the server</p>
      </Suspense>
      {/* Label has no directive: a Server Component here... */}
      <Label text="from-server" />
      <Toggle />
    </main>
  );
}
