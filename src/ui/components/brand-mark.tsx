/**
 * The Remote Agent mark: a chat bubble with a prompt, and an agent with a headset. It is the same drawing as
 * public/icon.svg without the background, so it takes its color from the surrounding text.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1240 1240" className={className} aria-hidden="true">
      <g transform="translate(620 620) scale(0.8) translate(-647.5 -636)" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M884 662V534Q884 406 756 406H290Q181 406 181 534V796Q181 912 300 912V1030L462 912H720" strokeWidth={52} />
        <path d="M335 555L455 660L335 765" strokeWidth={52} />
        <path d="M495 778H635" strokeWidth={46} />
        <path d="M712 262C880 262 980 340 1050 470" strokeWidth={42} />
        <path d="M1050 530C1085 580 1080 620 1075 660" strokeWidth={40} />
      </g>
      <g transform="translate(620 620) scale(0.8) translate(-647.5 -636)" fill="currentColor">
        <circle cx={855} cy={812} r={130} />
        <path d="M650 1085C650 1000 720 955 856 945C1000 955 1062 1010 1062 1085Z" />
        <circle cx={712} cy={262} r={78} />
        <circle cx={1050} cy={470} r={68} />
        <circle cx={1072} cy={700} r={66} />
      </g>
    </svg>
  )
}
