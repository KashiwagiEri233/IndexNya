/** react-force-graph-3d 最小类型声明（该包未随附完整 TS 类型）。 */
declare module "react-force-graph-3d" {
  import type { Component } from "react";

  export interface ForceGraph3DProps {
    width?: number;
    height?: number;
    graphData?: { nodes: any[]; links: any[] };
    backgroundColor?: string;
    nodeLabel?: string | ((node: any) => string);
    nodeColor?: string | ((node: any) => string);
    nodeVal?: number | string | ((node: any) => number);
    nodeRelSize?: number;
    linkWidth?: number | ((link: any) => number);
    linkColor?: string | ((link: any) => string);
    linkDirectionalParticles?: number | ((link: any) => number);
    linkDirectionalParticleWidth?: number | ((link: any) => number);
    linkDirectionalParticleSpeed?: number | ((link: any) => number);
    onNodeClick?: (node: any, event: any) => void;
    [key: string]: any;
  }

  export default class ForceGraph3D extends Component<ForceGraph3DProps> {}
}
