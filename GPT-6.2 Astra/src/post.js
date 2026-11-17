import * as T from 'three';

const vertex = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const depthFn = 'float linearZ(float d){return 10./(100.-d*99.9);}';
const blurFragment = `varying vec2 vUv;uniform sampler2D image,depth,glowDepth;uniform vec2 stepUv;uniform float maskDepth;
  ${depthFn}
  vec3 sampleInk(vec2 p){vec3 c=texture2D(image,p).rgb;if(maskDepth>.5){float z=linearZ(texture2D(glowDepth,p).r);float front=linearZ(texture2D(depth,p).r);c*=1.-smoothstep(.018,.067,z-front);}return c;}
  void main(){vec3 sum=sampleInk(vUv)*.227027;
  sum+=(sampleInk(vUv+stepUv*1.384615)+sampleInk(vUv-stepUv*1.384615))*.316216;
  sum+=(sampleInk(vUv+stepUv*3.230769)+sampleInk(vUv-stepUv*3.230769))*.070270;
  gl_FragColor=vec4(sum,1.);}`;
const finalFragment = `varying vec2 vUv;uniform sampler2D image,depth,bloom;uniform vec2 pixel;uniform vec3 paper,ink;uniform float focus,macro,codex,drawing;
  ${depthFn}
  float luma(vec4 c){return dot(c.rgb,vec3(.299,.587,.114))+.35*c.a;}
  vec4 fxaa(vec2 p){
    vec4 m=texture2D(image,p),nw=texture2D(image,p+pixel*vec2(-1.,1.)),ne=texture2D(image,p+pixel),sw=texture2D(image,p-pixel),se=texture2D(image,p+pixel*vec2(1.,-1.));
    float a=luma(nw),b=luma(ne),c=luma(sw),d=luma(se),e=luma(m);
    float lo=min(e,min(min(a,b),min(c,d))),hi=max(e,max(max(a,b),max(c,d)));
    if(hi-lo<max(.034,hi*.10))return m;
    vec2 dir=vec2(-(a+b-c-d),a+c-b-d);float r=max((a+b+c+d)*.03125,.0078125);
    dir=clamp(dir/(min(abs(dir.x),abs(dir.y))+r),vec2(-6.),vec2(6.))*pixel;
    vec4 f=(texture2D(image,p-dir/6.)+texture2D(image,p+dir/6.))*.5;
    vec4 g=f*.5+(texture2D(image,p-dir*.5)+texture2D(image,p+dir*.5))*.25;
    float lg=luma(g);return lg<lo||lg>hi?f:g;
  }
  vec3 film(vec3 x){x*=.91;return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
  void main(){
    vec4 src=fxaa(vUv);
    if(macro>.005){float z=linearZ(texture2D(depth,vUv).r);float coc=min(5.,abs(z-focus)*3.5)*macro;vec2 k=pixel*coc;
      vec4 sum=src;for(int i=0;i<16;i++){float a=float(i)*2.39996;float r=sqrt((float(i)+.5)/16.);sum+=texture2D(image,vUv+vec2(cos(a),sin(a))*k*r);}src=sum/17.;}
    vec2 q=vUv-vec2(.50,.55);float light=.988+.029*exp(-4.*dot(q,q))-.032*dot(q,q);
    float stain=.5+.5*sin(14.*q.x+1.8*sin(q.y*9.))*sin(11.*q.y+.8*cos(q.x*18.));light-=codex*(.047*stain+.07*dot(q,q));
    vec3 bg=paper*light;vec3 color=mix(bg,film(src.rgb/max(src.a,.0001)),clamp(src.a,0.,1.));
    if(drawing>.001){
      vec2 dx=vec2(1.12*pixel.x,0.),dy=vec2(0.,1.12*pixel.y);
      float z=linearZ(texture2D(depth,vUv).r);
      float ex=abs(linearZ(texture2D(depth,vUv+dx).r)+linearZ(texture2D(depth,vUv-dx).r)-2.*z);
      float ey=abs(linearZ(texture2D(depth,vUv+dy).r)+linearZ(texture2D(depth,vUv-dy).r)-2.*z);
      color=mix(color,ink,smoothstep(.019,.085,max(ex,ey))*drawing*.86);
    }
    color+=texture2D(bloom,vUv).rgb*(.105*(1.-drawing));gl_FragColor=vec4(color,1.);
    #include <colorspace_fragment>
  }`;
function target(depth = false, floating = false) {
  const rt = new T.WebGLRenderTarget(1, 1, {
    type: floating ? T.HalfFloatType : T.UnsignedByteType,
    depthBuffer: depth,
    format: T.RGBAFormat,
    minFilter: T.LinearFilter,
    magFilter: T.LinearFilter,
  });
  if (depth) {
    rt.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
    rt.depthTexture.format = T.DepthFormat;
  }
  return rt;
}
export class Optics {
  constructor(renderer, materials) {
    this.r = renderer;
    this.materials = materials;
    this.main = target(true, renderer.extensions.has('EXT_color_buffer_float'));
    this.main.samples = Math.min(renderer.capabilities.maxSamples, 2);
    this.emission = target(true);
    this.blurX = target();
    this.blurY = target();
    this.scene = new T.Scene();
    this.camera = new T.Camera();
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.blur = new T.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: blurFragment,
      uniforms: {
        image: { value: null },
        depth: { value: this.main.depthTexture },
        glowDepth: { value: this.emission.depthTexture },
        stepUv: { value: new T.Vector2() },
        maskDepth: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const uniforms = {
      image: { value: this.main.texture },
      depth: { value: this.main.depthTexture },
      bloom: { value: this.blurY.texture },
      pixel: { value: new T.Vector2() },
      paper: { value: materials.colors.floor },
      ink: { value: materials.colors.ink },
      focus: { value: 10 },
      macro: { value: 0 },
      codex: { value: 0 },
      drawing: materials.uniforms.draw,
    };
    this.final = new T.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: finalFragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.screen = new T.Mesh(g, this.final);
    this.screen.frustumCulled = false;
    this.scene.add(this.screen);
    this.w = 1;
    this.h = 1;
  }
  resize(w, h) {
    this.w = w;
    this.h = h;
    this.main.setSize(w, h);
    this.gw = Math.max(2, Math.ceil(w / 4));
    this.gh = Math.max(2, Math.ceil(h / 4));
    for (const rt of [this.emission, this.blurX, this.blurY]) rt.setSize(this.gw, this.gh);
    this.final.uniforms.pixel.value.set(1 / w, 1 / h);
  }
  render(scene, rig) {
    const r = this.r,
      cam = rig.camera,
      u = this.materials.uniforms;
    r.setRenderTarget(this.main);
    r.clear();
    r.render(scene, cam);
    const mask = cam.layers.mask;
    cam.layers.set(1);
    u.glow.value = 1;
    r.setRenderTarget(this.emission);
    r.clear();
    r.render(scene, cam);
    cam.layers.mask = mask;
    u.glow.value = 0;
    this.screen.material = this.blur;
    const b = this.blur.uniforms;
    b.image.value = this.emission.texture;
    b.maskDepth.value = 1;
    b.stepUv.value.set(1.3 / this.gw, 0);
    r.setRenderTarget(this.blurX);
    r.render(this.scene, this.camera);
    b.image.value = this.blurX.texture;
    b.maskDepth.value = 0;
    b.stepUv.value.set(0, 1.3 / this.gh);
    r.setRenderTarget(this.blurY);
    r.render(this.scene, this.camera);
    this.screen.material = this.final;
    this.final.uniforms.macro.value = rig.macro;
    this.final.uniforms.focus.value = rig.focusDepth;
    this.final.uniforms.codex.value = this.materials.weights[3];
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
