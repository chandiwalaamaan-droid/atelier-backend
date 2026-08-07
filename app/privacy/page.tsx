import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Rolichat",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-12 md:px-12">
      <div className="max-w-2xl mx-auto">
        <p className="text-sm text-parchment/60 mb-2">
          <Link href="/" className="hover:text-gold">
            ← Rolichat
          </Link>
        </p>
        <h1 className="font-display text-3xl mb-2">Privacy Policy</h1>
        <p className="text-sm text-parchment/50 mb-10">Last updated: July 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-parchment/80">
          <section>
            <h2 className="font-display text-xl text-parchment mb-2">What we collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Account info: email, display name, password (stored as a salted hash, never in plain text), and date of birth (used only to confirm you meet the 18+ requirement).</li>
              <li>Content you create: characters, chat messages, and any avatar images you upload or generate.</li>
              <li>Basic technical data: IP address (used for rate limiting and abuse prevention), timestamps, and error logs.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl text-parchment mb-2">How we use it</h2>
            <p>
              To run the service: authenticate you, store your characters and conversations, send messages to the
              underlying AI providers to generate replies, and send you account emails (verification, password
              reset). We don't sell your data or use your private conversations to train models we operate.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl text-parchment mb-2">Sharing</h2>
            <p>
              Chat messages are sent to third-party AI model providers to generate character replies; avatar
              generation may use a third-party image provider. Only characters you explicitly mark public appear in
              Discover — everything else, including all explicit-mode content, stays private to your account and is
              never shown to other users.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl text-parchment mb-2">Your choices</h2>
            <p>
              You can delete any character (and its messages) from your dashboard at any time. To delete your
              account entirely or request a copy of your data, contact us using the details on our site.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl text-parchment mb-2">Contact</h2>
            <p>
              Questions about this policy? Reach us via the contact details on our site. See also our{" "}
              <Link href="/terms" className="text-gold hover:underline">
                Terms of Service &amp; Content Policy
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
