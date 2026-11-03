import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const config = [
  ...nextVitals,
  ...nextTypescript,
  // Compiler diagnostics are advisory: this React 18 app does not enable React Compiler.
  { rules: {
    'react-hooks/set-state-in-effect': 'warn',
    'react-hooks/refs': 'warn',
    'react-hooks/static-components': 'warn',
    'react-hooks/preserve-manual-memoization': 'warn',
  } },
  { ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'tsconfig.tsbuildinfo', '_design-merch/**'] },
]

export default config
