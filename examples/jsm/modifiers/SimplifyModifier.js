import {
	BufferGeometry,
	Color,
	Float32BufferAttribute,
	Vector2,
	Vector3,
	Vector4
} from 'three';
import * as BufferGeometryUtils from '../utils/BufferGeometryUtils.js';

/**
 *	Simplification Geometry Modifier
 *    - based on code and technique
 *	  - by Stan Melax in 1998
 *	  - Progressive Mesh type Polygon Reduction Algorithm  // 渐进式网格型多边形约简算法
 *    - http://www.melax.com/polychop/
 */

const _cb = new Vector3(), _ab = new Vector3();
// SimplifyModifier代码解释

class SimplifyModifier {

	modify( geometry, count ) {

		geometry = geometry.clone();

		// currently morphAttributes are not supported
		// 目前不支持morphAttributes
		delete geometry.morphAttributes.position;
		delete geometry.morphAttributes.normal;
		const attributes = geometry.attributes;

		// this modifier can only process indexed and non-indexed geomtries with at least a position attribute
		// 此修饰符只能处理至少具有位置属性的索引和非索引几何

		for ( const name in attributes ) {

			if ( name !== 'position' && name !== 'uv' && name !== 'normal' && name !== 'tangent' && name !== 'color' ) geometry.deleteAttribute( name );

		}

		geometry = BufferGeometryUtils.mergeVertices( geometry );

		//
		// put data of original geometry in different data structures
		// 将原始几何数据放入不同的数据结构中
		//

		const vertices = [];
		const faces = [];

		// add vertices
		// 添加顶点数组

		const positionAttribute = geometry.getAttribute( 'position' );
		const uvAttribute = geometry.getAttribute( 'uv' );
		const normalAttribute = geometry.getAttribute( 'normal' );
		const tangentAttribute = geometry.getAttribute( 'tangent' );
		const colorAttribute = geometry.getAttribute( 'color' );

		let t = null;
		let v2 = null;
		let nor = null;
		let col = null;

		for ( let i = 0; i < positionAttribute.count; i ++ ) {

			const v = new Vector3().fromBufferAttribute( positionAttribute, i );
			if ( uvAttribute ) {

				v2 = new Vector2().fromBufferAttribute( uvAttribute, i );

			}

			if ( normalAttribute ) {

				nor = new Vector3().fromBufferAttribute( normalAttribute, i );

			}

			if ( tangentAttribute ) {

				t = new Vector4().fromBufferAttribute( tangentAttribute, i );

			}

			if ( colorAttribute ) {

				col = new Color().fromBufferAttribute( colorAttribute, i );

			}

			const vertex = new Vertex( v, v2, nor, t, col ); // 新的Vertex 类 包含这个点对应的 uv normal tangent color
			vertices.push( vertex ); // 全部推入 vertices 数组中

		}

		// add faces
		// 添加面信息

		let index = geometry.getIndex();

		// 没有index的提取面的处理
		if ( index !== null ) {

			for ( let i = 0; i < index.count; i += 3 ) {

				const a = index.getX( i );
				const b = index.getX( i + 1 );
				const c = index.getX( i + 2 );

				const triangle = new Triangle( vertices[ a ], vertices[ b ], vertices[ c ], a, b, c ); // 新的面类 
				faces.push( triangle );

			}

		} else {// 有index的提取面的处理

			for ( let i = 0; i < positionAttribute.count; i += 3 ) {

				const a = i;
				const b = i + 1;
				const c = i + 2;

				const triangle = new Triangle( vertices[ a ], vertices[ b ], vertices[ c ], a, b, c );
				faces.push( triangle );

			}

		}

		// compute all edge collapse costs 
		// 计算所有边折叠代价

		for ( let i = 0, il = vertices.length; i < il; i ++ ) {

			computeEdgeCostAtVertex( vertices[ i ] );

		}

		let nextVertex;

		// 根据目标数量塌陷物体的定点数量
		let z = count;

		while ( z -- ) {

			nextVertex = minimumCostEdge( vertices );// 选出当前数组中最小的边缘消耗的点用来塌陷

			if ( ! nextVertex ) {

				console.log( 'THREE.SimplifyModifier: No next vertex' );
				break;

			}

			// 对该点进行塌陷
			collapse( vertices, faces, nextVertex, nextVertex.collapseNeighbor );

		}

		// 将塌陷后的geometry生成对应的buffer geometry

		const simplifiedGeometry = new BufferGeometry();
		const position = [];
		const uv = [];
		const normal = [];
		const tangent = [];
		const color = [];

		index = [];

		//

		for ( let i = 0; i < vertices.length; i ++ ) {

			const vertex = vertices[ i ];
			position.push( vertex.position.x, vertex.position.y, vertex.position.z );
			if ( vertex.uv ) {

				uv.push( vertex.uv.x, vertex.uv.y );

			}

			if ( vertex.normal ) {

				normal.push( vertex.normal.x, vertex.normal.y, vertex.normal.z );

			}

			if ( vertex.tangent ) {

				tangent.push( vertex.tangent.x, vertex.tangent.y, vertex.tangent.z, vertex.tangent.w );

			}

			if ( vertex.color ) {

				color.push( vertex.color.r, vertex.color.g, vertex.color.b );

			}


			// cache final index to GREATLY speed up faces reconstruction
			vertex.id = i;

		}

		//

		for ( let i = 0; i < faces.length; i ++ ) {

			const face = faces[ i ];
			index.push( face.v1.id, face.v2.id, face.v3.id );

		}

		simplifiedGeometry.setAttribute( 'position', new Float32BufferAttribute( position, 3 ) );
		if ( uv.length > 0 ) simplifiedGeometry.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
		if ( normal.length > 0 ) simplifiedGeometry.setAttribute( 'normal', new Float32BufferAttribute( normal, 3 ) );
		if ( tangent.length > 0 ) simplifiedGeometry.setAttribute( 'tangent', new Float32BufferAttribute( tangent, 4 ) );
		if ( color.length > 0 ) simplifiedGeometry.setAttribute( 'color', new Float32BufferAttribute( color, 3 ) );

		simplifiedGeometry.setIndex( index );

		return simplifiedGeometry;

	}

}

// 用于向数组中添加唯一的对象。
// 如果对象不在数组中，则添加它；否则，不执行任何操作。  
function pushIfUnique( array, object ) {

	if ( array.indexOf( object ) === - 1 ) array.push( object );

}

function removeFromArray( array, object ) {

	// 使用 indexOf 方法查找数组中 object 的索引位置。  
    // indexOf 方法会遍历数组，并返回第一个与给定对象严格相等（===）的元素的索引。  
    // 如果没有找到，则返回 -1。  
	const k = array.indexOf( object );
	// 判断 object 是否存在于数组中（即 indexOf 返回的索引是否大于 -1）。
	// 如果存在，使用 splice 方法从数组中移除该对象。  
    // splice 方法会删除从索引 k 开始的 1 个元素（即 object），并返回被删除的元素组成的数组（但在这个函数中我们并没有使用这个返回值）。  
    // 注意：这个方法会直接修改原数组。    
	if ( k > - 1 ) array.splice( k, 1 );
	// 函数没有返回值（隐式返回 undefined），因为它直接修改了传入的数组。  

}

function computeEdgeCollapseCost( u, v ) {

	// if we collapse edge uv by moving u to v then how
	// much different will the model change, i.e. the "error".
	// 如果我们通过移动u到v来折叠uv边，那么
    // 模型会发生很大的变化，即“误差”。

	const edgelength = v.position.distanceTo( u.position );
	let curvature = 0;

	const sideFaces = [];

	// find the "sides" triangles that are on the edge uv
	// 找到边uv上的“边”三角形
	// 找到同时包含当前点与要判断的u点与其邻接的v 的面
	for ( let i = 0, il = u.faces.length; i < il; i ++ ) {

		const face = u.faces[ i ];

		if ( face.hasVertex( v ) ) {

			sideFaces.push( face );

		}

	}

	// use the triangle facing most away from the sides
	// to determine our curvature term
    // 使用最远离边的三角形
    // 来决定曲率项
	for ( let i = 0, il = u.faces.length; i < il; i ++ ) {

		let minCurvature = 1;
		const face = u.faces[ i ];

		for ( let j = 0; j < sideFaces.length; j ++ ) {

			const sideFace = sideFaces[ j ];
			// use dot product of face normals.
			// 使用面法线的点积。
			const dotProd = face.normal.dot( sideFace.normal ); // 两个面的法线单位向量的点积，用于判断两个夹角的大小
			minCurvature = Math.min( minCurvature, ( 1.001 - dotProd ) / 2 ); // 选出该线段相邻面 与 该点当前关联的面 的夹角最小的值

		}

		// 选出该线段相邻面 与 该点当所有关联的面 的夹角最大的值（每个面与其线段相邻面最小值中的最大值）
		curvature = Math.max( curvature, minCurvature );

	}

	// crude approach in attempt to preserve borders
	// though it seems not to be totally correct
	//试图保留边界的粗糙方法
    //虽然这似乎并不完全正确
	const borders = 0;

	// 考虑该线段有多少相邻三角面的因素，当只有一个三角面相邻的时候 扩大最终结果
	// 可以理解为该线段在末端 不应该被塌陷，塌陷就会造成形变很大。
	if ( sideFaces.length < 2 ) {

		// we add some arbitrary cost for borders,
		// borders += 10;
		//我们为边界添加一些任意的开销，
        //边界+= 10;
		curvature = 1;

	}

	// 最终因素值导出
	const amt = edgelength * curvature + borders;

	return amt;

}

// 这段代码的目的是在给定的顶点v上计算并确定一个“边缘折叠”（edge collapse）的成本，
// 这是网格简化（mesh simplification）或网格优化过程中的一个常见步骤。
// 边缘折叠指的是通过移除一个边和它的一个顶点（通常选择度数较低的顶点），并将相邻的顶点连接起来，
// 以减少网格的复杂性和顶点数量，同时尽可能保持网格的形状和细节。
function computeEdgeCostAtVertex( v ) {

	// compute the edge collapse cost for all edges that start
	// from vertex v.  Since we are only interested in reducing
	// the object by selecting the min cost edge at each step, we
	// only cache the cost of the least cost edge at this vertex
	// (in member variable collapse) as well as the value of the
	// cost (in member variable collapseCost).

	// 为从顶点v出发的所有边计算边缘折叠成本。  
    // 我们只关心通过选择最小成本的边来减少对象，  
    // 因此我们只在成员变量中缓存此顶点的最小成本边（collapse）和该成本（collapseCost）。 

	if ( v.neighbors.length === 0 ) {
		// 如果没有邻居顶点，则认为折叠成本极低（比如-0.01），因为无需折叠任何边。  
        // 这里假设了collapseNeighbor设为null，表示没有可以折叠的边。  

		// collapse if no neighbors.
		// 如果没有邻居就会崩溃。
		v.collapseNeighbor = null;
		v.collapseCost = - 0.01;

		// 直接返回，因为没有边可以处理。  
		return;

	}

	// 初始化最小成本为一个较大的值，以便找到真正的最小值。  
    // 同时初始化collapseNeighbor为null，因为没有初始的最小成本边。  
	v.collapseCost = 100000;
	v.collapseNeighbor = null;

	// search all neighboring edges for "least cost" edge
	// 在所有相邻边中搜索“代价最小”的边
	// 遍历顶点v的所有邻居，寻找“最小成本”的边  
	for ( let i = 0; i < v.neighbors.length; i ++ ) {

		 // 计算当前边（v到v.neighbors[i]）的边缘折叠成本 
		const collapseCost = computeEdgeCollapseCost( v, v.neighbors[ i ] );

		// 如果是第一次找到邻居，则直接设置collapseNeighbor和collapseCost  
		if ( ! v.collapseNeighbor ) {

			v.collapseNeighbor = v.neighbors[ i ];
			v.collapseCost = collapseCost;
			// 这里还额外设置了minCost、totalCost和costCount，但在当前逻辑中可能并不必要或多余
			v.minCost = collapseCost;
			v.totalCost = 0; // 这里设置0但在后续立即被覆盖，可能仅为初始化  
			v.costCount = 0; // 同上  

		}

		// 更新成本统计（但在当前逻辑中可能不是最终需要的）
		v.costCount ++;
		v.totalCost += collapseCost;

		// 如果当前边的成本更低，则更新collapseNeighbor和minCost  
		if ( collapseCost < v.minCost ) {

			v.collapseNeighbor = v.neighbors[ i ];
			v.minCost = collapseCost;

		}

	}

	// 注意：这里的v.collapseCost赋值逻辑可能不是预期的。  
    // 它计算了所有邻居边的平均成本，但在网格简化的上下文中，  
    // 我们通常只关心最小成本的那条边（即v.minCost），  
    // 而不是所有边的平均成本。因此，最后一行通常会被注释掉，  
    // 使用v.minCost作为最终的collapseCost。  
    // v.collapseCost = v.totalCost / v.costCount; // 这条通常被替换为：  
	// we average the cost of collapsing at this vertex
	v.collapseCost = v.totalCost / v.costCount;
	// v.collapseCost = v.minCost; // 使用最小成本作为折叠成本  

}

function removeVertex( v, vertices ) {

	console.assert( v.faces.length === 0 );

	while ( v.neighbors.length ) {

		const n = v.neighbors.pop();
		removeFromArray( n.neighbors, v );

	}

	removeFromArray( vertices, v );

}

function removeFace( f, faces ) {

	removeFromArray( faces, f );

	if ( f.v1 ) removeFromArray( f.v1.faces, f );
	if ( f.v2 ) removeFromArray( f.v2.faces, f );
	if ( f.v3 ) removeFromArray( f.v3.faces, f );

	// TODO optimize this!
	const vs = [ f.v1, f.v2, f.v3 ];

	for ( let i = 0; i < 3; i ++ ) {

		const v1 = vs[ i ];
		const v2 = vs[ ( i + 1 ) % 3 ];

		if ( ! v1 || ! v2 ) continue;

		v1.removeIfNonNeighbor( v2 );
		v2.removeIfNonNeighbor( v1 );

	}

}

// collapse函数用于折叠边uv，即将顶点u移动到顶点v的位置
function collapse( vertices, faces, u, v ) {

	// Collapse the edge uv by moving vertex u onto v
	// 如果v不存在，说明u是一个孤立的顶点，直接删除  

	if ( ! v ) {

		// u is a vertex all by itself so just delete it..
		removeVertex( u, vertices );
		return;

	}

	// 如果v有UV坐标，将u的UV坐标更新为v的UV坐标  
	if ( v.uv ) {

		u.uv.copy( v.uv );

	}

	// 如果v有法线信息，将u的法线与v的法线相加后归一化，更新v的法线 
	if ( v.normal ) {

		v.normal.add( u.normal ).normalize();

	}

	// 如果v有切线信息，将u的切线与v的切线相加后归一化，更新v的切线
	if ( v.tangent ) {

		v.tangent.add( u.tangent ).normalize();

	}

	// 创建一个临时数组来存储u的所有邻接顶点
	const tmpVertices = [];

	// 遍历u的所有邻接顶点，将它们添加到tmpVertices中  
	for ( let i = 0; i < u.neighbors.length; i ++ ) {

		tmpVertices.push( u.neighbors[ i ] );

	}


	// delete triangles on edge uv:
	// 反向遍历u的所有面，删除包含边uv的面  
	for ( let i = u.faces.length - 1; i >= 0; i -- ) {

		if ( u.faces[ i ] && u.faces[ i ].hasVertex( v ) ) {

			removeFace( u.faces[ i ], faces );

		}

	}

	// update remaining triangles to have v instead of u
	// 再次反向遍历u的所有面，更新剩余面以使用v代替u  
	for ( let i = u.faces.length - 1; i >= 0; i -- ) {

		u.faces[ i ].replaceVertex( u, v );

	}


	// 删除顶点u  
	removeVertex( u, vertices );

	// recompute the edge collapse costs in neighborhood
	// 对u的邻接顶点重新计算边折叠代价  
	for ( let i = 0; i < tmpVertices.length; i ++ ) {

		computeEdgeCostAtVertex( tmpVertices[ i ] );

	}

}



// 这个函数的目标是找到给定顶点数组中collapseCost属性最小的顶点，并返回它。  
function minimumCostEdge( vertices ) {

	// 初始化least变量为数组中的第一个顶点，假设它是具有最小collapseCost的顶点。  
    // 这是一个常见的做法，但我们需要遍历整个数组来验证这个假设。  
	// O(n * n) approach. TODO optimize this

	let least = vertices[ 0 ];

	// 遍历顶点数组中的每一个顶点  
	for ( let i = 0; i < vertices.length; i ++ ) {

		// 检查当前顶点的collapseCost是否小于least变量当前所指向的顶点的collapseCost
		if ( vertices[ i ].collapseCost < least.collapseCost ) {

			// 如果是，更新least变量，使其指向当前具有更小collapseCost的顶点
			least = vertices[ i ];

		}

	}

	// 遍历完成后，least变量将指向数组中collapseCost最小的顶点。  
    // 返回这个顶点作为函数的结果。  
	return least;

}

// we use a triangle class to represent structure of face slightly differently

// 定义一个Triangle类，表示三角形。  
class Triangle {

	// 构造函数，接收六个参数：三个顶点和三条边的长度（但边的长度在这里并未直接使用）。  
	// v1 v2 v3 为该三角面三个点详细信息， abc为该三个点的索引
	constructor( v1, v2, v3, a, b, c ) {

		// 存储三条边的长度（但实际上在后续代码中并未使用这些长度）
		this.a = a;
		this.b = b;
		this.c = c;

		// 存储三角形的三个顶点。  
		this.v1 = v1;
		this.v2 = v2;
		this.v3 = v3;

		// 初始化法线向量为一个新的Vector3对象（假设Vector3是一个已经定义好的三维向量类）。
		this.normal = new Vector3();

		// 计算并设置三角形的法线向量。  
		this.computeNormal();

		// 将当前三角形添加到其三个顶点的faces数组中，表示这些顶点参与了当前三角形的构成。
		v1.faces.push( this );
		v1.addUniqueNeighbor( v2 );// 确保v1和v2是邻接顶点，并且这种关系在v1和v2之间是唯一的。 
		v1.addUniqueNeighbor( v3 );// 确保v1和v3是邻接顶点，并且这种关系在v1和v3之间是唯一的。  

		v2.faces.push( this );
		v2.addUniqueNeighbor( v1 );
		v2.addUniqueNeighbor( v3 );


		v3.faces.push( this );
		v3.addUniqueNeighbor( v1 );
		v3.addUniqueNeighbor( v2 );

	}

	// 计算并设置三角形的法线向量。  
	computeNormal() {

		// 使用顶点的位置来计算两个向量vA-vB和vA-vC。 
		const vA = this.v1.position;
		const vB = this.v2.position;
		const vC = this.v3.position;

		// 假设_cb和_ab是已经定义好的Vector3对象，用于临时存储向量。
		_cb.subVectors( vC, vB );// 计算向量CB。 
		_ab.subVectors( vA, vB );// 计算向量AB。
		// 使用cross方法计算AB和CB的叉积，得到法线向量，并归一化。    
		_cb.cross( _ab ).normalize();

		// 将计算得到的法线向量复制到当前三角形的normal属性中。 
		this.normal.copy( _cb );

	}

	// 检查给定的顶点v是否是当前三角形的一个顶点。 
	hasVertex( v ) {

		// 使用严格相等（===）来比较顶点。  
		return v === this.v1 || v === this.v2 || v === this.v3;

	}

	// 替换三角形中的一个顶点。  
	replaceVertex( oldv, newv ) {

		// 检查并替换顶点。  
		if ( oldv === this.v1 ) this.v1 = newv;
		else if ( oldv === this.v2 ) this.v2 = newv;
		else if ( oldv === this.v3 ) this.v3 = newv;

		// 从旧顶点的faces数组中移除当前三角形。 
		removeFromArray( oldv.faces, this );
		// 将当前三角形添加到新顶点的faces数组中。  
		newv.faces.push( this );


		// 更新邻接顶点关系。  
		// 注意：这里假设removeIfNonNeighbor会正确处理邻接顶点的更新。  
		oldv.removeIfNonNeighbor( this.v1 );
		this.v1.removeIfNonNeighbor( oldv );

		oldv.removeIfNonNeighbor( this.v2 );
		this.v2.removeIfNonNeighbor( oldv );

		oldv.removeIfNonNeighbor( this.v3 );
		this.v3.removeIfNonNeighbor( oldv );

		// 接下来，虽然这一步在逻辑上可能是多余的（因为替换操作已经隐含地更新了邻接关系），  
        // 但这里显式地重新添加了三角形的顶点之间的邻接关系。  
        // 这可能是为了确保邻接关系的完整性，尽管在正常的替换操作中通常不需要这样做。 
		this.v1.addUniqueNeighbor( this.v2 );
		this.v1.addUniqueNeighbor( this.v3 );

		this.v2.addUniqueNeighbor( this.v1 );
		this.v2.addUniqueNeighbor( this.v3 );

		this.v3.addUniqueNeighbor( this.v1 );
		this.v3.addUniqueNeighbor( this.v2 );

		// 最后，重新计算三角形的法线向量。因为顶点的位置已经改变（通过替换），  
        // 所以需要重新计算法线以确保其准确性。  
		this.computeNormal();

	}

}

class Vertex {

	// Vertex类的构造函数，用于创建一个新的顶点对象。  
    // 参数包括顶点的位置(v)、UV坐标(uv)、法线(normal)、切线(tangent)和颜色(color)。  
	constructor( v, uv, normal, tangent, color ) {

		// 存储顶点的位置。  
		this.position = v;
		this.uv = uv;// 存储顶点的UV坐标，用于纹理映射。  
		this.normal = normal;// 存储顶点的法线向量，用于光照计算。  
		this.tangent = tangent; // 存储顶点的切线向量，通常用于法线映射或其他高级渲染技术。  
		this.color = color;// 存储顶点的颜色信息。  

		// 顶点的ID，这里初始化为-1，可能用于在顶点列表中的外部引用（例如生成面时）。  
		this.id = - 1; // external use position in vertices list (for e.g. face generation)

		// 存储与这个顶点相连的面（三角形）的数组。 
		this.faces = []; // faces vertex is connected
		// 存储与这个顶点相邻的顶点的数组，即“邻接顶点”。 
		this.neighbors = []; // neighbouring vertices aka "adjacentVertices"

		// 以下两个属性将在computeEdgeCostAtVertex()方法中计算，用于顶点优化或简化算法。  
		// 顶点折叠的成本，值越小表示折叠这个顶点越好。  
		// these will be computed in computeEdgeCostAtVertex()
		this.collapseCost = 0; // cost of collapsing this vertex, the less the better. aka objdist
		// 折叠这个顶点时的最佳候选邻接顶点。 
		this.collapseNeighbor = null; // best candinate for collapsing

	}

	// 向顶点的邻接顶点数组中添加一个唯一的顶点。  
    // 如果该顶点已经存在，则不会重复添加。  
	addUniqueNeighbor( vertex ) {

		// 假设pushIfUnique是一个辅助函数，用于在数组中添加唯一的元素。  
        // 这里它用于确保不会向neighbors数组中添加重复的顶点。  
		pushIfUnique( this.neighbors, vertex );

	}

	// 如果给定的顶点n不再是当前顶点的邻接顶点（即不再共享任何面），则从邻接顶点数组中移除它。
	removeIfNonNeighbor( n ) {

		const neighbors = this.neighbors;// 当前顶点的邻接顶点数组  
		const faces = this.faces;// 当前顶点所属的面数组  

		const offset = neighbors.indexOf( n );// 查找给定顶点n在邻接顶点数组中的索引  

		// 如果n不在邻接顶点数组中，则直接返回。 
		if ( offset === - 1 ) return;

		// 遍历当前顶点所属的所有面，检查是否还有面包含顶点n。  
        // 如果有，说明n仍然是邻接顶点，不应被移除。  
		for ( let i = 0; i < faces.length; i ++ ) {

			// 如果发现包含n的面，则返回不执行移除。 
			if ( faces[ i ].hasVertex( n ) ) return;

		}

		// 如果遍历完所有面都没有发现包含n的面，则从邻接顶点数组中移除n。
		neighbors.splice( offset, 1 );

	}

}

export { SimplifyModifier };
