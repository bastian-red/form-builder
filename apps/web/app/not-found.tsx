import { Brand } from '../components/brand';

/**
 * One page for "does not exist" and "is not yours", deliberately identical: the
 * API answers both with 404 so a guessed id reveals nothing, and a page that
 * worded them differently would be the leak.
 */
export default function NotFound() {
  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <Brand />
        <h1 className="auth-title">Nothing at this address</h1>
        <p className="muted">
          The form may have been deleted, or the link may have been mistyped. If someone sent it to
          you, ask them for a new one.
        </p>
      </div>
    </main>
  );
}
