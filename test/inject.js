console.warn('INJECTED-OK');
// Injected at document start: GL diagnostics for the Time Crisis WASM port.
window.warnOnce = m => console.warn('warnOnce: ' + m);
(() => {
  const protos = [WebGLRenderingContext.prototype];
  if (window.WebGL2RenderingContext) protos.push(WebGL2RenderingContext.prototype);
  for (const proto of protos) {
    const oSrc = proto.shaderSource;
    proto.shaderSource = function (sh, src) {
      console.warn('SRC>>> ' + src.split('\n').join(' | '));
      return oSrc.call(this, sh, src);
    };
    const oLink = proto.linkProgram;
    proto.linkProgram = function (p) {
      oLink.call(this, p);
      const ok = this.getProgramParameter(p, this.LINK_STATUS);
      if (!ok) console.warn('LINKFAIL>>> ' + this.getProgramInfoLog(p));
    };
  }
})();
