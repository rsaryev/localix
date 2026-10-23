// TypeScript 7 checks side-effect imports, so `import './board.css'` fails to type-check without a
// declaration. The host's artifact build bundles the stylesheet; the compiler only needs to know
// the specifier is a module. (Mini apps built with their own Vite get this from `vite/client`.)
declare module '*.css'
