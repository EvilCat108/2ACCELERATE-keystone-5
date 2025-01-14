import { Node, Value } from 'slate';
import assert from 'nanoassert';
import { walkSlateNode } from './slate-walker';

// Convert a Node to JSON without the .nodes list, which avoids recursively
// calling .toJSON() on all child nodes.
function shallowNodeToJson(node) {
  if (node.nodes) {
    return node.set('nodes', Node.createList()).toJSON();
  }
  return node.toJSON();
}

/**
 * @param document Object For example:
 * [
 *   { object: 'block', type: 'cloudinaryImage', data: { file: <FileObject>, align: 'center' } },
 *   { object: 'block', type: 'cloudinaryImage', data: { file: <FileObject>, align: 'center' } },
 *   { object: 'block', type: 'relationshipTag', data: { name: 'foobar' } }
 *   { object: 'block', type: 'relationshipUser', data: { _joinIds: ['xyz789'], id: 'uoi678' } }
 * ]
 *
 * @return Object For example:
 * {
 *   document: [
 *     { object: 'block', type: 'cloudinaryImage', data: { _mutationPath: 'cloudinaryImages.create[0]' } },
 *     { object: 'block', type: 'cloudinaryImage', data: { _mutationPath: 'cloudinaryImages.create[1]' } },
 *     { object: 'block', type: 'relationshipTag', data: { _mutationPath: 'relationshipTags.create[0]' } }
 *     { object: 'block', type: 'relationshipUser', data: { _mutationPath: 'relationshipUsers.connect[0]' } }
 *   ],
 *   cloudinaryImages: {
 *     create: [
 *       { image: <FileObject>, align: 'center' },
 *       { image: <FileObject>, align: 'center' },
 *     ]
 *   },
 *   relationshipTags: {
 *     create: [{ tag: { create: { name: 'foobar' } } }],
 *   },
 *   relationshipUsers: {
 *     connect: [{ id: 'xyz789' }],
 *   },
 * }
 */
export function serialiseSlateValue(value, blocks) {
  const allMutations = {};

  const serializedDocument = walkSlateNode(value.document, {
    visitBlock(node) {
      const block = blocks[node.type];

      // No matching block that we're in charge of
      if (!block) {
        return;
      }

      const { mutations, node: serializedNode } = block.serialize({ value, node });

      if (mutations && Object.keys(mutations).length) {
        if (!serializedNode) {
          throw new Error(
            `Must return a serialized 'node' when returning 'mutations'. See '${
              block.constructor.name
            }#serialize()'.`
          );
        }

        if (!block.path) {
          throw new Error(
            `No mutation path set for block view type '${
              block.type
            }'. Ensure the block's view exports a 'path' key corresponding to the mutation path for saving block data`
          );
        }

        // Ensure the mutation group exists
        allMutations[block.path] = allMutations[block.path] || {
          // TODO: Don't forcible disconnect & reconnect. (It works because we know
          // the entire document, so all creations & connections exist below).
          // Really, we should do a diff and only perform the things that have
          // actually changed. Although, this may be quite complex.
          disconnectAll: true,
        };

        // Ensure there's a .data._mutationPaths array
        serializedNode.data = serializedNode.data || {};
        serializedNode.data._mutationPaths = serializedNode.data._mutationPaths || [];

        // Gather up all the mutations, keyed by the block's path & the
        // "action" returned by the serialize call.
        Object.entries(mutations).forEach(([action, mutationData]) => {
          allMutations[block.path][action] = allMutations[block.path][action] || [];

          mutationData = Array.isArray(mutationData) ? mutationData : [mutationData];

          mutationData.forEach(mutation => {
            const insertedBefore = allMutations[block.path][action].push(mutation);

            const mutationPath = `${block.path}.${action}[${insertedBefore - 1}]`;

            serializedNode.data._mutationPaths.push(mutationPath);
          });
        });
      }

      return serializedNode ? serializedNode : null;
    },
    // Everything we don't handle, we turn into JSON, but still visit all
    // the child nodes.
    defaultVisitor(node, visitNode) {
      // visit this node first
      const visitedNode = shallowNodeToJson(node);

      if (node.nodes) {
        // Now we recurse into the child nodes array
        visitedNode.nodes = node.nodes.map(childNode => visitNode(childNode)).toJSON();
      }

      return visitedNode;
    },
  });

  return {
    document: serializedDocument,
    ...allMutations,
  };
}

/**
 * @param document Object For example:
 * {
 *   document: [
 *     { object: 'block', type: 'cloudinaryImage', data: { _joinIds: ['abc123'] } },
 *     { object: 'block', type: 'cloudinaryImage', data: { _joinIds: ['qwe345'] } },
 *     { object: 'block', type: 'relationshipUser', data: { _joinIds: ['ert567'] } }
 *     { object: 'block', type: 'relationshipUser', data: { _joinIds: ['xyz890'] } }
 *   ],
 *   cloudinaryImages: [
 *     { id: 'abc123', publicUrl: '...', align: 'center' },
 *     { id: 'qwe345', publicUrl: '...', align: 'center' },
 *   ],
 *   relationshipUsers: [
 *     { id: 'ert567', user: { id: 'dfg789' } },
 *     { id: 'xyz890', user: { id: 'uoi678' } },
 *   ],
 * }
 *
 * @return Object For example:
 * [
 *   { object: 'block', type: 'cloudinaryImage', data: { _joinIds: ['abc123'], publicUrl: '...', align: 'center' } },
 *   { object: 'block', type: 'cloudinaryImage', data: { _joinIds: ['qwe345'], publicUrl: '...', align: 'center' } },
 *   { object: 'block', type: 'relationshipUser', data: { _joinIds: ['ert567'], user: { id: 'dfg789' } } }
 *   { object: 'block', type: 'relationshipUser', data: { _joinIds: ['xyz789'], user: { id: 'uoi678' } } }
 * ]
 */
export function deserialiseToSlateValue({ document, ...serializations }, blocks) {
  assert(!!document, 'Must pass document to deserialiseToSlateValue()');
  assert(!!blocks, 'Must pass blocks to deserialiseToSlateValue()');

  const value = Value.fromJSON({ document });

  return value.set(
    'document',
    walkSlateNode(value.document, {
      visitBlock(node) {
        const block = blocks[node.type];

        // No matching block that we're in charge of
        if (!block) {
          return;
        }

        // Pick out the data set based on the block's path
        const data = serializations[block.path];

        const nodeData = node.get('data');

        const joins = ((nodeData && nodeData.size && nodeData.get('_joinIds')) || []).map(joinId =>
          data.find(({ id }) => joinId === id)
        );

        // NOTE: deserialize _may_ return null. It will then fall into the
        // `defaultVisitor` handler below.
        const newNode = block.deserialize({ node, joins });

        // Returning falsey will fall through to the default visitor below
        if (!newNode) {
          return;
        }

        if (!Node.isNode(newNode)) {
          throw new Error(`${block.constructor.name}#deserialize() must return a Slate.js Node.`);
        }

        return newNode;
      },
      defaultVisitor(node, visitNode) {
        if (node.nodes) {
          // Now we recurse into the child nodes array
          // NOTE: The result is immutable, so we have to return the result of
          // `.set` here.
          return node.set('nodes', node.nodes.map(visitNode));
        }

        return node;
      },
    })
  );
}
