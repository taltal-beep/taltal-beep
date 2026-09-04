import struct, sys

def load(p):
    d=open(p,'rb').read()
    off=struct.unpack_from('<I',d,10)[0]
    w,h=struct.unpack_from('<ii',d,18); topdown=h<0; h=abs(h)
    row=(w*3+3)//4*4
    px=[]
    for y in range(h):
        yy=y if topdown else h-1-y
        base=off+yy*row
        px.append([0.299*d[base+x*3+2]+0.587*d[base+x*3+1]+0.114*d[base+x*3] for x in range(w)])
    return px,w,h

def render(path, cols, x0f, y0f, x1f, y1f, ramp, gamma=1.0, equalize=True, invert=False,
           vignette=None, feather=0.30):
    px,W,H = load(path)
    x0,x1 = int(x0f*W), int(x1f*W)
    y0,y1 = int(y0f*H), int(y1f*H)
    cw, ch = x1-x0, y1-y0
    # char cell is 0.6 wide for every 1.0 tall, so rows follow from the crop's aspect
    rows = max(1, round(0.6*cols*ch/cw))
    cell_w, cell_h = cw/cols, ch/rows
    grid=[]
    for r in range(rows):
        line=[]
        for c in range(cols):
            sy0,sy1 = y0+int(r*cell_h), y0+max(int(r*cell_h)+1, int((r+1)*cell_h))
            sx0,sx1 = x0+int(c*cell_w), x0+max(int(c*cell_w)+1, int((c+1)*cell_w))
            n=0; s=0.0
            for yy in range(sy0,min(sy1,H)):
                r_=px[yy]
                for xx in range(sx0,min(sx1,W)):
                    s+=r_[xx]; n+=1
            line.append(s/max(n,1))
        grid.append(line)

    flat=sorted(v for r in grid for v in r)
    N=len(flat)
    if equalize:
        # rank-based: every character in the ramp gets used about equally
        rank={}
        for i,v in enumerate(flat): rank.setdefault(v,i)
        norm=[[rank[v]/(N-1) for v in r] for r in grid]
    else:
        lo,hi=flat[0],flat[-1]
        norm=[[(v-lo)/(hi-lo) for v in r] for r in grid]
    # A rectangular crop of a photo drags in whatever squared-off background
    # sits in the corners. Fading towards an ellipse dissolves that instead of
    # leaving a hard block, while leaving the head itself untouched.
    def vig(c, r):
        if not vignette:
            return 1.0
        dx = ((c + 0.5) / cols * 2 - 1) / vignette
        dy = ((r + 0.5) / rows * 2 - 1) / vignette
        d = (dx * dx + dy * dy) ** 0.5
        if d <= 1.0:
            return 1.0
        if d >= 1.0 + feather:
            return 0.0
        t = (d - 1.0) / feather
        return 1.0 - t * t * (3 - 2 * t)  # smoothstep

    out=[]
    for r_i, r in enumerate(norm):
        chars=[]
        for c_i, v in enumerate(r):
            x = v if not invert else 1 - v
            x = (x ** gamma) * vig(c_i, r_i)
            chars.append(ramp[min(len(ramp)-1, int(x*len(ramp)))])
        out.append("".join(chars))
    return out

if __name__=="__main__":
    import json
    cfg=json.loads(sys.argv[1])
    print("\n".join(render(**cfg)))

# The committed scripts/ascii-art.txt was produced with:
#
#   sips -s format bmp -z 576 519 photo.png --out photo.bmp
#   python3 make-ascii.py '{"path":"photo.bmp","cols":86,
#     "x0f":0.245,"y0f":0.180,"x1f":0.945,"y1f":0.845,
#     "ramp":" .:-=+*#%@","equalize":false,"gamma":1.5,"invert":true,
#     "vignette":0.85,"feather":0.30}'
#
# invert=true is what makes a photo read at all: dark hair becomes dense
# characters and the bright background drops out to whitespace. gamma>1 pushes
# the near-background tones to blank so the wall stops dithering. The crop is
# set to the head's real bounds (hair spans x 0.27-0.91, chin sits at y 0.81)
# with padding, and the vignette dissolves the square corners the crop drags
# in -- without it the dark window shutter lands as a hard block bottom-right.
