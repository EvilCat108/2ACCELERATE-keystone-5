import { importView } from '@keystone-alpha/build-field-types';
import { Block } from '../../../Block';
import listItem from './list-item';

export default class OrderedListBlock extends Block {
  get type() {
    return 'ordered-list';
  }
  getAdminViews() {
    return [importView('../views/editor/blocks/ordered-list'), ...new listItem().getAdminViews()];
  }
}
