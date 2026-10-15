import Link from 'next/link';

/**
 * The wordmark and its mark: a vertical spine with one branch leaving it and
 * rejoining further down -- the builder's logic gutter, drawn at 14px.
 */
export function Brand({ href = '/' }: { readonly href?: string }) {
  return (
    <Link className="brand" href={href}>
      <svg className="brand-mark" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <path d="M9 1v12" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <path d="M9 3H4.5v8H9" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <circle cx="9" cy="11" r="1.6" fill="currentColor" />
      </svg>
      form-builder
    </Link>
  );
}
