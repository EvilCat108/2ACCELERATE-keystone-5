import { importView } from '@keystone-alpha/build-field-types';
import { Block } from '../../../Block';

export default class LinkBlock extends Block {
  get type() {
    return 'link';
  }
  getAdminViews() {
    return [importView('../views/editor/blocks/link')];
  }
}
