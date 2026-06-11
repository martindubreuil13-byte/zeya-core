"use client";

export function MinimalNav() {
  return (
    <>
      {/* Top-left: Zeya signature */}
      <div
        className="fixed top-10 left-10 z-20 transition-opacity duration-1000"
      >
        <div className="font-serif text-2xl font-light text-zeya-ivory tracking-wide"
             style={{
               letterSpacing: '0.08em',
               lineHeight: '1.2',
               fontVariantNumeric: 'normal',
               textRendering: 'optimizeLegibility',
             }}>
          Zeya
        </div>
        {/* Subtle underline suggestion */}
        <div className="h-px mt-2 w-12 bg-gradient-to-r from-zeya-champagne via-zeya-champagne to-transparent opacity-30"></div>
      </div>

      {/* Top-right: Ghost pill navigation */}
      <div
        className="fixed top-10 right-10 z-20 flex gap-6 transition-opacity duration-1000"
      >
        <a
          href="#"
          className="px-4 py-2 text-xs tracking-widest text-zeya-hush border border-zeya-hush/30 rounded-full transition-all duration-300 hover:border-zeya-champagne hover:text-zeya-champagne hover:bg-zeya-champagne hover:bg-opacity-5"
          style={{
            fontSize: '0.65rem',
            letterSpacing: '0.15em',
          }}
        >
          Learn
        </a>
        <a
          href="/login"
          className="px-4 py-2 text-xs tracking-widest text-zeya-hush border border-zeya-hush/30 rounded-full transition-all duration-300 hover:border-zeya-champagne hover:text-zeya-champagne hover:bg-zeya-champagne hover:bg-opacity-5"
          style={{
            fontSize: '0.65rem',
            letterSpacing: '0.15em',
          }}
        >
          Login
        </a>
      </div>
    </>
  );
}
